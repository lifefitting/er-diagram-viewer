import { describe, expect, it } from 'vitest';
import { nodeId } from '../diagram/nodeId';
import { parseSql } from '../parser';
import { mergeShardedTables } from '../infer/mergeShardedTables';
import {
  buildTableRemap,
  hasTableOverlap,
  tableIdentityIds,
} from './reconcileSqlUpdate';

function merged(sql: string) {
  return mergeShardedTables(parseSql(sql)).schema;
}

describe('tableIdentityIds', () => {
  it('includes display name, base and physical shards for merged tables', () => {
    const schema = merged(`
      CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY);
      CREATE TABLE orders_2025 (id BIGINT PRIMARY KEY);
    `);
    const table = schema.tables[0];
    expect(table.name).toBe('orders_*');
    expect(tableIdentityIds(table)).toEqual(
      new Set([nodeId('orders_*'), nodeId('orders'), nodeId('orders_2024'), nodeId('orders_2025')]),
    );
  });
});

describe('hasTableOverlap', () => {
  it('detects overlap across shard-merge rename', () => {
    const current = merged('CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY);');
    const next = merged(`
      CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY);
      CREATE TABLE orders_2025 (id BIGINT PRIMARY KEY);
    `);
    expect(hasTableOverlap(current, next)).toBe(true);
  });

  it('returns false for unrelated schemas', () => {
    const current = merged('CREATE TABLE users (id BIGINT PRIMARY KEY);');
    const next = merged('CREATE TABLE ledger (id BIGINT PRIMARY KEY);');
    expect(hasTableOverlap(current, next)).toBe(false);
  });
});

describe('buildTableRemap', () => {
  it('maps a lone shard card onto the merged representative', () => {
    const current = merged('CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY, total INT);');
    const next = merged(`
      CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_2025 (id BIGINT PRIMARY KEY, total INT);
    `);
    const remap = buildTableRemap(current, next);
    expect(remap.get(nodeId('orders_2024'))).toBe('orders_*');
  });

  it('maps orders_* onto absorbed base table name', () => {
    const current = merged(`
      CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_2025 (id BIGINT PRIMARY KEY, total INT);
    `);
    const next = merged(`
      CREATE TABLE orders (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_2024 (id BIGINT PRIMARY KEY, total INT);
      CREATE TABLE orders_2025 (id BIGINT PRIMARY KEY, total INT);
    `);
    const remap = buildTableRemap(current, next);
    expect(remap.get(nodeId('orders_*'))).toBe('orders');
  });
});
