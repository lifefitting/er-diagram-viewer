import { describe, expect, it } from 'vitest';
import { parseSql } from './index';

describe('parseSql / CREATE TABLE', () => {
  it('parses a simple MySQL CREATE TABLE with backticks and PK', () => {
    const sql = `
      CREATE TABLE \`users\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`email\` VARCHAR(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY uniq_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='users';
    `;
    const schema = parseSql(sql);
    expect(schema.tables).toHaveLength(1);
    const t = schema.tables[0];
    expect(t.name).toBe('users');
    expect(t.primaryKey).toEqual(['id']);
    expect(t.columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(t.columns[0].isAutoIncrement).toBe(true);
    expect(t.columns[0].nullable).toBe(false);
    expect(t.columns[1].isUnique).toBe(true);
    expect(t.comment).toBe('users');
  });

  it('handles inline PRIMARY KEY and inline REFERENCES', () => {
    const sql = `
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        user_id INT REFERENCES users(id)
      );
    `;
    const schema = parseSql(sql);
    const t = schema.tables[1];
    expect(t.primaryKey).toEqual(['id']);
    expect(schema.explicitForeignKeys).toEqual([
      expect.objectContaining({
        fromTable: 'orders',
        fromColumns: ['user_id'],
        toTable: 'users',
        toColumns: ['id'],
        source: 'explicit',
      }),
    ]);
  });

  it('captures table-level FOREIGN KEY constraints', () => {
    const sql = `
      CREATE TABLE orders (id INT PRIMARY KEY);
      CREATE TABLE products (id INT PRIMARY KEY);
      CREATE TABLE order_items (
        id INT PRIMARY KEY,
        order_id INT,
        product_id INT,
        CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
    `;
    const schema = parseSql(sql);
    expect(schema.explicitForeignKeys).toHaveLength(2);
    const named = schema.explicitForeignKeys.find((fk) => fk.constraintName === 'fk_order');
    expect(named).toBeDefined();
    expect(named?.toTable).toBe('orders');
  });

  it('parses ALTER TABLE ADD CONSTRAINT FK', () => {
    const sql = `
      CREATE TABLE a (id INT PRIMARY KEY);
      CREATE TABLE b (id INT PRIMARY KEY, a_id INT);
      ALTER TABLE b ADD CONSTRAINT fk_b_a FOREIGN KEY (a_id) REFERENCES a(id);
    `;
    const schema = parseSql(sql);
    expect(schema.explicitForeignKeys).toEqual([
      expect.objectContaining({ fromTable: 'b', toTable: 'a', constraintName: 'fk_b_a' }),
    ]);
  });

  it('ignores dialect noise (ENGINE, SERIAL, comments, strings with semicolons)', () => {
    const sql = `
      /* multi
         line ; comment */
      CREATE TABLE notes (
        id BIGSERIAL PRIMARY KEY,
        body TEXT NOT NULL DEFAULT 'hi; world'
      );
      -- ignore me;
      INSERT INTO notes VALUES (1, 'x');
    `;
    const schema = parseSql(sql);
    expect(schema.tables.map((t) => t.name)).toEqual(['notes']);
    expect(schema.tables[0].columns[0].isAutoIncrement).toBe(true);
    expect(schema.tables[0].columns[1].defaultValue).toContain("'hi; world'");
  });

  it('captures CREATE INDEX after the table', () => {
    const sql = `
      CREATE TABLE addresses (id INT PRIMARY KEY, user_id INT);
      CREATE INDEX idx_addr_user ON addresses(user_id);
    `;
    const schema = parseSql(sql);
    const t = schema.tables[0];
    expect(t.indexes).toEqual([
      expect.objectContaining({ name: 'idx_addr_user', columns: ['user_id'], unique: false }),
    ]);
    const userCol = t.columns.find((c) => c.name === 'user_id');
    expect(userCol?.hasIndex).toBe(true);
  });

  it('drops FKs referencing tables not defined in the script, with a warning', () => {
    const sql = `
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        user_id INT REFERENCES users(id)
      );
      ALTER TABLE orders ADD CONSTRAINT fk_o_w FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
    `;
    const schema = parseSql(sql);
    expect(schema.tables).toHaveLength(1);
    expect(schema.explicitForeignKeys).toEqual([]);
    const danglingWarnings = schema.warnings.filter((w) => w.message.includes('not defined'));
    expect(danglingWarnings).toHaveLength(2);
    expect(danglingWarnings[0].snippet).toContain('users');
  });

  it('keeps FKs whose endpoint tables differ only in case', () => {
    const sql = `
      CREATE TABLE Users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        user_id INT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `;
    const schema = parseSql(sql);
    expect(schema.explicitForeignKeys).toHaveLength(1);
  });
});
