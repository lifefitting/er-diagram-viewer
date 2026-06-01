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
    expect(inferred).toEqual([expect.objectContaining({ fromTable: 't_post', toTable: 't_user' })]);
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

  it('infers a _ref-suffixed column as a foreign key', () => {
    const sql = `
      CREATE TABLE credential (id BIGINT PRIMARY KEY);
      CREATE TABLE credential_device (
        id BIGINT PRIMARY KEY,
        credential_ref BIGINT NOT NULL,
        UNIQUE KEY uk_ref (credential_ref)
      );
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toEqual([
      expect.objectContaining({
        fromTable: 'credential_device',
        fromColumns: ['credential_ref'],
        toTable: 'credential',
        toColumns: ['id'],
      }),
    ]);
    // The reason explains the column was matched via its _ref suffix.
    expect(inferred[0].reason).toContain('_ref');
  });

  it('matches a camelCase Ref suffix', () => {
    const sql = `
      CREATE TABLE account (id BIGINT PRIMARY KEY);
      CREATE TABLE token (id BIGINT PRIMARY KEY, accountRef BIGINT, KEY idx_a (accountRef));
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toEqual([
      expect.objectContaining({ fromColumns: ['accountRef'], toTable: 'account' }),
    ]);
  });

  it('resolves a _ref column to a same-namespace prefixed table (credential_ref → iam_credential)', () => {
    // The bare base `credential` only reaches `iam_credential` via the shared
    // `iam_` namespace prefix of the source tables.
    const sql = `
      CREATE TABLE iam_credential (id BIGINT UNSIGNED PRIMARY KEY);
      CREATE TABLE iam_credential_device (
        id BIGINT UNSIGNED PRIMARY KEY,
        credential_ref BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        UNIQUE KEY uk_credential_ref (credential_ref)
      );
      CREATE TABLE iam_challenge (
        id BIGINT UNSIGNED PRIMARY KEY,
        credential_ref BIGINT UNSIGNED DEFAULT NULL
      );
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    const refs = inferred.filter((fk) => fk.fromColumns[0] === 'credential_ref');
    expect(refs.map((fk) => `${fk.fromTable} → ${fk.toTable}`)).toEqual([
      'iam_credential_device → iam_credential',
      'iam_challenge → iam_credential',
    ]);
    expect(refs.every((fk) => fk.confidence === 'medium')).toBe(true);
    // user_id has no iam_user target → no false positive.
    expect(inferred).toHaveLength(2);
  });

  it('does not treat lowercase ...ref words (href / pref) as foreign keys', () => {
    const sql = `
      CREATE TABLE page (id BIGINT PRIMARY KEY);
      CREATE TABLE link (id BIGINT PRIMARY KEY, href VARCHAR(255), pref BIGINT);
    `;
    const schema = parseSql(sql);
    const inferred = inferForeignKeys(schema);
    expect(inferred).toHaveLength(0);
  });
});
