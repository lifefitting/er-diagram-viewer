import { describe, expect, it } from 'vitest';
import type { Column, Schema, Table } from '../parser/types';
import { canonicalFkKey, canonicalizeLogicalFk } from '../parser/utils';
import { discoverBusinessKeys, inferLogicalLinks } from './inferLogicalLinks';
import { runPipeline } from '../store/pipeline';

const col = (name: string, over: Partial<Column> = {}): Column => ({
  name,
  rawType: 'varchar(64)',
  normalizedType: 'string',
  nullable: true,
  isPrimaryKey: false,
  isUnique: false,
  hasIndex: false,
  isAutoIncrement: false,
  ...over,
});

const table = (name: string, columns: Column[], primaryKey: string[] = ['id']): Table => ({
  name,
  columns: [col('id', { normalizedType: 'int', isPrimaryKey: true }), ...columns],
  primaryKey,
  indexes: [],
});

const schemaOf = (tables: Table[]): Schema => ({
  tables,
  explicitForeignKeys: [],
  warnings: [],
});

describe('canonicalizeLogicalFk', () => {
  const base = {
    fromColumns: ['out_trade_no'],
    toColumns: ['out_trade_no'],
    source: 'manual' as const,
    kind: 'logical' as const,
  };

  it('orders endpoints lexicographically and is idempotent', () => {
    const reversed = { ...base, fromTable: 'zeta', toTable: 'alpha' };
    const norm = canonicalizeLogicalFk(reversed);
    expect(norm.fromTable).toBe('alpha');
    expect(norm.toTable).toBe('zeta');
    expect(canonicalizeLogicalFk(norm)).toBe(norm); // already ordered → same ref
    // Both directions collapse to one key.
    expect(canonicalFkKey(norm)).toBe(
      canonicalFkKey(canonicalizeLogicalFk({ ...base, fromTable: 'alpha', toTable: 'zeta' })),
    );
  });

  it('leaves physical FKs untouched', () => {
    const fk = { ...base, kind: 'fk' as const, fromTable: 'zeta', toTable: 'alpha' };
    expect(canonicalizeLogicalFk(fk)).toBe(fk);
  });
});

describe('inferLogicalLinks', () => {
  it('star topology around the unique holder (hub), medium confidence', () => {
    const schema = schemaOf([
      table('orders', [col('out_trade_no', { hasIndex: true })]),
      table('payments', [col('out_trade_no', { isUnique: true, hasIndex: true })]),
      table('refunds', [col('out_trade_no')]),
    ]);
    const { links, notices } = inferLogicalLinks(schema);
    expect(notices).toEqual([]);
    expect(links).toHaveLength(2);
    for (const l of links) {
      expect(l.kind).toBe('logical');
      expect(l.confidence).toBe('medium');
      expect(l.reason).toContain('unique on payments (hub)');
      // Star: payments is one endpoint of every link.
      expect([l.fromTable, l.toTable]).toContain('payments');
    }
  });

  it('pairwise mesh at low confidence when no unique side (k ≤ 4)', () => {
    const schema = schemaOf([
      table('a_t', [col('batch_no', { hasIndex: true })]),
      table('b_t', [col('batch_no')]),
      table('c_t', [col('batch_no')]),
    ]);
    const { links } = inferLogicalLinks(schema);
    expect(links).toHaveLength(3); // C(3,2)
    expect(links.every((l) => l.confidence === 'low')).toBe(true);
  });

  it('restricts generation to onlyNames (the user-picked keys)', () => {
    const schema = schemaOf([
      table('orders', [col('out_trade_no'), col('batch_no')]),
      table('payments', [col('out_trade_no', { isUnique: true }), col('batch_no')]),
    ]);
    const all = inferLogicalLinks(schema).links;
    expect(all).toHaveLength(2); // both clusters when unrestricted
    const onlyOtn = inferLogicalLinks(schema, new Set(), new Set(), new Set(['out_trade_no']));
    expect(onlyOtn.links).toHaveLength(1);
    expect(onlyOtn.links[0].fromColumns).toEqual(['out_trade_no']);
  });

  it('emits a notice instead of edges for k > 4 without a unique side', () => {
    const schema = schemaOf(
      ['t1', 't2', 't3', 't4', 't5'].map((n) => table(n, [col('batch_no')])),
    );
    const { links, notices } = inferLogicalLinks(schema);
    expect(links).toHaveLength(0);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('batch_no');
  });

  it('ignores blacklisted audit/tenancy columns', () => {
    const schema = schemaOf([
      table('a_t', [col('created_at'), col('tenant_id'), col('status')]),
      table('b_t', [col('created_at'), col('tenant_id'), col('status')]),
    ]);
    expect(inferLogicalLinks(schema).links).toHaveLength(0);
  });

  it('requires compatible types; unknown joins anything', () => {
    const incompatible = schemaOf([
      table('a_t', [col('biz_no', { normalizedType: 'string', hasIndex: true })]),
      table('b_t', [col('biz_no', { normalizedType: 'int' })]),
    ]);
    expect(inferLogicalLinks(incompatible).links).toHaveLength(0);

    const withUnknown = schemaOf([
      table('a_t', [col('biz_no', { normalizedType: 'string', hasIndex: true })]),
      table('b_t', [col('biz_no', { normalizedType: 'unknown' })]),
    ]);
    expect(inferLogicalLinks(withUnknown).links).toHaveLength(1);
  });

  it('skips column names consumed by FK inference and colliding keys', () => {
    const schema = schemaOf([
      table('orders', [col('out_trade_no')]),
      table('payments', [col('out_trade_no', { isUnique: true })]),
    ]);
    expect(inferLogicalLinks(schema, new Set(['out_trade_no'])).links).toHaveLength(0);

    const key = canonicalFkKey({
      fromTable: 'orders',
      fromColumns: ['out_trade_no'],
      toTable: 'payments',
      toColumns: ['out_trade_no'],
      source: 'explicit',
    });
    expect(inferLogicalLinks(schema, new Set(), new Set([key])).links).toHaveLength(0);
  });

  it('stores endpoints direction-normalized', () => {
    const schema = schemaOf([
      // Declared in reverse-lexicographic order to prove normalization.
      table('zeta', [col('trade_no', { isUnique: true })]),
      table('alpha', [col('trade_no')]),
    ]);
    const { links } = inferLogicalLinks(schema);
    expect(links).toHaveLength(1);
    expect(links[0].fromTable).toBe('alpha');
    expect(links[0].toTable).toBe('zeta');
  });
});

describe('discoverBusinessKeys', () => {
  it('surveys clusters with hub info; oversized no-hub clusters are unselectable', () => {
    const schema = schemaOf([
      ...['t1', 't2', 't3', 't4', 't5'].map((n) => table(n, [col('batch_no')])),
      table('orders', [col('out_trade_no')]),
      table('payments', [col('out_trade_no', { isUnique: true })]),
    ]);
    const clusters = discoverBusinessKeys(schema);
    expect(clusters.map((c) => c.name)).toEqual(['out_trade_no', 'batch_no']); // hub first
    const otn = clusters[0];
    expect(otn.hubTable).toBe('payments');
    expect(otn.selectable).toBe(true);
    const batch = clusters[1];
    expect(batch.hubTable).toBeUndefined();
    expect(batch.tables).toHaveLength(5);
    expect(batch.selectable).toBe(false); // > MAX_PAIRWISE_TABLES, no hub
  });

  it('applies the blacklist and the FK-consumed exclusion', () => {
    const schema = schemaOf([
      table('a_t', [col('created_at'), col('user_id')]),
      table('b_t', [col('created_at'), col('user_id')]),
    ]);
    expect(discoverBusinessKeys(schema)).toHaveLength(1); // user_id only
    expect(discoverBusinessKeys(schema, new Set(['user_id']))).toHaveLength(0);
  });
});

describe('runPipeline integration', () => {
  const SQL = [
    'CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT NOT NULL, out_trade_no VARCHAR(64));',
    'CREATE TABLE payments (id BIGINT PRIMARY KEY, out_trade_no VARCHAR(64), UNIQUE KEY uk_otn (out_trade_no));',
    'CREATE TABLE refunds (id BIGINT PRIMARY KEY, out_trade_no VARCHAR(64));',
    'CREATE TABLE users (id BIGINT PRIMARY KEY);',
  ].join('\n');

  it('produces NO logical candidates unless the user picked keys', () => {
    const { inferred } = runPipeline(SQL, 'vibrant');
    expect(inferred.some((f) => f.kind === 'logical')).toBe(false);
    expect(inferred.some((f) => f.toTable === 'users')).toBe(true); // FK inference untouched
  });

  it('generates candidates only for the picked keys; logical stays out of module clustering', () => {
    const { inferred, modules } = runPipeline(SQL, 'vibrant', ['out_trade_no']);
    const logical = inferred.filter((f) => f.kind === 'logical');
    expect(logical).toHaveLength(2); // star around payments (unique side)
    expect(logical.every((l) => [l.fromTable, l.toTable].includes('payments'))).toBe(true);
    // Business keys must NOT merge the payment/order/refund domains into one
    // module — only FK edges (and prefixes) may cluster.
    expect(modules.byTable.get('payments')).not.toBe(modules.byTable.get('refunds'));
  });
});
