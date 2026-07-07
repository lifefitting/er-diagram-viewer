import { describe, expect, it } from 'vitest';
import { parseSql } from '../parser';
import { extractShardBase, mergeShardedTables, SHARD_SUFFIX_PATTERNS } from './mergeShardedTables';

describe('extractShardBase', () => {
  it('strips _YYYYMM suffixes', () => {
    expect(extractShardBase('account_detail_202401')).toBe('account_detail');
    expect(extractShardBase('AccountDetail_202412')).toBe('AccountDetail');
  });

  it('strips _YYYYMMDD suffixes before _YYYY', () => {
    // Critical ordering check: 8-digit dates must NOT be matched as a 4-digit suffix
    // (which would leave 4 trailing digits behind in the base).
    expect(extractShardBase('t_log_20230101')).toBe('t_log');
    expect(extractShardBase('t_log_20230102')).toBe('t_log');
  });

  it('strips _YYYY_MM_DD with separators', () => {
    expect(extractShardBase('events_2024_05_01')).toBe('events');
  });

  it('strips _YYYY_MM with separators', () => {
    expect(extractShardBase('events_2024_05')).toBe('events');
  });

  it('strips _pN partitions', () => {
    expect(extractShardBase('users_p0')).toBe('users');
    expect(extractShardBase('users_p15')).toBe('users');
  });

  it('strips _shardN and _partN', () => {
    expect(extractShardBase('orders_shard3')).toBe('orders');
    expect(extractShardBase('orders_part01')).toBe('orders');
  });

  it('strips numeric suffix as catch-all', () => {
    expect(extractShardBase('orders_99')).toBe('orders');
    expect(extractShardBase('orders_0001')).toBe('orders');
  });

  it('returns null for names with no shard suffix', () => {
    expect(extractShardBase('user')).toBeNull();
    expect(extractShardBase('user_profile')).toBeNull();
    expect(extractShardBase('orders')).toBeNull();
  });

  it('keeps the suffix-pattern list non-empty and ordered (regression guard)', () => {
    expect(SHARD_SUFFIX_PATTERNS.length).toBeGreaterThan(0);
    // First entry should be the longest specific date format so 8-digit dates win.
    expect(SHARD_SUFFIX_PATTERNS[0].source).toContain('\\d{4}_\\d{2}_\\d{2}');
  });
});

describe('mergeShardedTables', () => {
  it('merges three monthly shards into one representative', () => {
    const sql = `
      CREATE TABLE account_detail_202401 (id BIGINT PRIMARY KEY, balance INT);
      CREATE TABLE account_detail_202402 (id BIGINT PRIMARY KEY, balance INT);
      CREATE TABLE account_detail_202403 (id BIGINT PRIMARY KEY, balance INT);
    `;
    const schema = parseSql(sql);
    const result = mergeShardedTables(schema);
    expect(result.groups).toHaveLength(1);
    expect(result.schema.tables.map((t) => t.name)).toEqual(['account_detail_*']);
    const rep = result.schema.tables[0];
    expect(rep.shardInfo?.base).toBe('account_detail');
    expect(rep.shardInfo?.shards).toEqual([
      'account_detail_202401',
      'account_detail_202402',
      'account_detail_202403',
    ]);
    expect(result.notices[0]).toContain('account_detail_*');
  });

  it('recognizes _YYYYMMDD day-shards', () => {
    const sql = `
      CREATE TABLE t_log_20230101 (id BIGINT PRIMARY KEY, msg VARCHAR(200));
      CREATE TABLE t_log_20230102 (id BIGINT PRIMARY KEY, msg VARCHAR(200));
    `;
    const schema = parseSql(sql);
    const result = mergeShardedTables(schema);
    expect(result.schema.tables.map((t) => t.name)).toEqual(['t_log_*']);
    expect(result.schema.tables[0].shardInfo?.base).toBe('t_log');
  });

  it('recognizes _pNN partition shards', () => {
    const stmts: string[] = [];
    for (let i = 0; i <= 15; i++) {
      const suf = String(i).padStart(2, '0');
      stmts.push(`CREATE TABLE users_p${suf} (id BIGINT PRIMARY KEY, name VARCHAR(80));`);
    }
    const schema = parseSql(stmts.join('\n'));
    const result = mergeShardedTables(schema);
    expect(result.groups).toHaveLength(1);
    expect(result.schema.tables[0].name).toBe('users_*');
    expect(result.schema.tables[0].shardInfo?.shards).toHaveLength(16);
  });

  it('does not merge a single shard-suffix table on its own', () => {
    const sql = `CREATE TABLE orders (id BIGINT PRIMARY KEY);`;
    const schema = parseSql(sql);
    const result = mergeShardedTables(schema);
    expect(result.groups).toHaveLength(0);
    expect(result.schema.tables.map((t) => t.name)).toEqual(['orders']);
  });

  it('does not merge same-prefix tables when the suffix is not shard-shaped', () => {
    const sql = `
      CREATE TABLE user (id BIGINT PRIMARY KEY);
      CREATE TABLE user_profile (id BIGINT PRIMARY KEY, user_id BIGINT);
    `;
    const schema = parseSql(sql);
    const result = mergeShardedTables(schema);
    expect(result.groups).toHaveLength(0);
    expect(result.schema.tables.map((t) => t.name).sort()).toEqual(['user', 'user_profile']);
  });

  it('picks the representative with the most columns; ties go alphabetical', () => {
    const sql = `
      CREATE TABLE log_202402 (id BIGINT PRIMARY KEY, msg TEXT);
      CREATE TABLE log_202401 (id BIGINT PRIMARY KEY, msg TEXT, extra1 INT, extra2 INT);
      CREATE TABLE log_202403 (id BIGINT PRIMARY KEY, msg TEXT);
    `;
    const schema = parseSql(sql);
    const result = mergeShardedTables(schema);
    expect(result.groups).toHaveLength(1);
    // Rep is the 4-column shard (log_202401), display name is log_*.
    const rep = result.schema.tables[0];
    expect(rep.name).toBe('log_*');
    expect(rep.columns.map((c) => c.name).sort()).toEqual(['extra1', 'extra2', 'id', 'msg']);
  });

  it('redirects FKs that referenced a shard to the representative and drops intra-shard self-loops', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE account_detail_202401 (
        id BIGINT PRIMARY KEY,
        user_id BIGINT,
        prev_id BIGINT,
        CONSTRAINT fk_u FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_p FOREIGN KEY (prev_id) REFERENCES account_detail_202312(id)
      );
      CREATE TABLE account_detail_202312 (id BIGINT PRIMARY KEY, user_id BIGINT);
    `;
    const schema = parseSql(sql);
    const result = mergeShardedTables(schema);
    expect(result.schema.tables.map((t) => t.name).sort()).toEqual(['account_detail_*', 'users']);
    // The intra-shard FK collapses to a self-loop and is dropped.
    // The cross-shard FK (account_detail_* → users) is preserved.
    const fks = result.schema.explicitForeignKeys;
    expect(fks).toHaveLength(1);
    expect(fks[0].fromTable).toBe('account_detail_*');
    expect(fks[0].toTable).toBe('users');
  });

  it('leaves schemas without shard groups untouched (no notices)', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT);
    `;
    const schema = parseSql(sql);
    const before = JSON.stringify(schema);
    const result = mergeShardedTables(schema);
    expect(result.notices).toEqual([]);
    expect(JSON.stringify(result.schema)).toBe(before);
  });
});

describe('mergeShardedTables / base-table absorption', () => {
  it('absorbs a compatible suffix-less base table; the node keeps the base name', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202402 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202403 (id BIGINT PRIMARY KEY, total INT);
    `;
    const result = mergeShardedTables(parseSql(sql));
    expect(result.groups).toHaveLength(1);
    expect(result.schema.tables.map((t) => t.name)).toEqual(['orders']);
    const rep = result.schema.tables[0];
    expect(rep.shardInfo?.base).toBe('orders');
    expect(rep.shardInfo?.shards).toEqual(['orders_202401', 'orders_202402', 'orders_202403']);
    expect(result.groups[0].baseTableName).toBe('orders');
    expect(result.notices.join('')).toContain('基表 + 3 张分表');
  });

  it('rewrites FKs pointing at a shard to the base name and drops base↔shard self-loops', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY);
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, parent_id BIGINT,
        CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES orders(id));
      CREATE TABLE payments (id BIGINT PRIMARY KEY, order_id BIGINT,
        CONSTRAINT fk_o FOREIGN KEY (order_id) REFERENCES orders_202401(id));
    `;
    const result = mergeShardedTables(parseSql(sql));
    expect(result.schema.tables.map((t) => t.name).sort()).toEqual(['orders', 'payments']);
    const fks = result.schema.explicitForeignKeys;
    // The partition→parent FK collapses to a self-loop and is dropped; the
    // external FK that targeted a physical shard now lands on `orders`.
    expect(fks).toHaveLength(1);
    expect(fks[0].fromTable).toBe('payments');
    expect(fks[0].toTable).toBe('orders');
  });

  it('merges base + a single shard (a lone shard without a base still does not)', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, total INT);
    `;
    const result = mergeShardedTables(parseSql(sql));
    expect(result.groups).toHaveLength(1);
    expect(result.schema.tables.map((t) => t.name)).toEqual(['orders']);
    expect(result.schema.tables[0].shardInfo?.shards).toEqual(['orders_202401']);
  });

  it('keeps an incompatible same-named table separate and emits a neutral notice', () => {
    const sql = `
      CREATE TABLE orders (code VARCHAR(40) PRIMARY KEY, label VARCHAR(80));
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202402 (id BIGINT PRIMARY KEY, total INT);
    `;
    const result = mergeShardedTables(parseSql(sql));
    // Shards still merge to orders_* under the old convention; the base stays.
    expect(result.schema.tables.map((t) => t.name).sort()).toEqual(['orders', 'orders_*']);
    expect(result.groups[0].baseTableName).toBeUndefined();
    expect(result.notices.join('')).toContain('列结构不一致');
  });

  it('emits the incompatibility notice even when no group forms (base + one mismatched shard)', () => {
    const sql = `
      CREATE TABLE orders (code VARCHAR(40) PRIMARY KEY);
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, total INT);
    `;
    const result = mergeShardedTables(parseSql(sql));
    expect(result.groups).toHaveLength(0);
    expect(result.schema.tables.map((t) => t.name).sort()).toEqual(['orders', 'orders_202401']);
    expect(result.notices.join('')).toContain('列结构不一致');
  });

  it('adopts the widest shard definition while keeping the base name', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, total INT, extra1 INT, extra2 INT);
      CREATE TABLE orders_202402 (id BIGINT PRIMARY KEY, total INT);
    `;
    const result = mergeShardedTables(parseSql(sql));
    const rep = result.schema.tables[0];
    expect(rep.name).toBe('orders');
    expect(rep.columns.map((c) => c.name).sort()).toEqual(['extra1', 'extra2', 'id', 'total']);
  });

  it('matches the base table case-insensitively and keeps its original casing', () => {
    const sql = `
      CREATE TABLE Orders (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202401 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_202402 (id BIGINT PRIMARY KEY, total INT);
    `;
    const result = mergeShardedTables(parseSql(sql));
    expect(result.groups).toHaveLength(1);
    expect(result.schema.tables.map((t) => t.name)).toEqual(['Orders']);
  });
});
