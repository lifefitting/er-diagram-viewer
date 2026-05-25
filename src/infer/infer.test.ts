import { describe, expect, it } from 'vitest';
import { parseSql } from '../parser';
import { inferForeignKeys } from './inferForeignKeys';

describe('inferForeignKeys', () => {
  it('matches user_id → users (high confidence when source is indexed)', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE orders (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        KEY idx_user (user_id)
      );
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toEqual([
      expect.objectContaining({
        fromTable: 'orders',
        fromColumns: ['user_id'],
        toTable: 'users',
        toColumns: ['id'],
        confidence: 'high',
      }),
    ]);
  });

  it('lowers confidence to medium when source column has no index', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT NOT NULL);
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred[0].confidence).toBe('medium');
  });

  it('filters out type-incompatible candidates', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE legacy (id BIGINT PRIMARY KEY, user_id VARCHAR(40), KEY idx_user (user_id));
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toHaveLength(0);
  });

  it('strips t_ / tbl_ prefixes when matching the target table', () => {
    const sql = `
      CREATE TABLE t_user (id BIGINT PRIMARY KEY);
      CREATE TABLE t_post (id BIGINT PRIMARY KEY, user_id BIGINT, KEY idx_user (user_id));
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toEqual([
      expect.objectContaining({ fromTable: 't_post', toTable: 't_user' }),
    ]);
  });

  it('falls back to compound-prefix matching with low confidence', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE comments (id BIGINT PRIMARY KEY, parent_user_id BIGINT);
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred[0]).toMatchObject({
      fromColumns: ['parent_user_id'],
      toTable: 'users',
      confidence: 'low',
    });
  });

  it('does not duplicate explicit foreign keys', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE orders (
        id BIGINT PRIMARY KEY,
        user_id BIGINT,
        CONSTRAINT fk_u FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toHaveLength(0);
  });

  it('chooses the indexed candidate when name is ambiguous', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE user_profiles (id BIGINT PRIMARY KEY);
      CREATE TABLE sessions (
        id BIGINT PRIMARY KEY,
        user_id BIGINT,
        KEY idx_user (user_id)
      );
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred[0]).toMatchObject({ toTable: 'users' });
  });
});
