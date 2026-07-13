import { describe, expect, it } from 'vitest';
import { parseSql } from '../parser';
import { inferForeignKeys } from './inferForeignKeys';
import { inferModules, MODULE_PALETTES } from './inferModules';

function moduleFor(sql: string, tableName: string): string | undefined {
  const schema = parseSql(sql);
  const inferred = inferForeignKeys(schema).filter((f) => f.confidence !== 'low');
  const fks = [...schema.explicitForeignKeys, ...inferred];
  return inferModules(schema, fks).byTable.get(tableName);
}

describe('inferModules', () => {
  it('groups tables that share the leading name token', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY);
      CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
      CREATE TABLE order_shipments (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
    `;
    expect(moduleFor(sql, 'orders')).toBe('order');
    expect(moduleFor(sql, 'order_items')).toBe('order');
    expect(moduleFor(sql, 'order_shipments')).toBe('order');
  });

  it('normalizes singular/plural so users and user_profile share a module', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE user_profile (id BIGINT PRIMARY KEY, user_id BIGINT, KEY idx_user (user_id));
    `;
    expect(moduleFor(sql, 'users')).toBe('user');
    expect(moduleFor(sql, 'user_profile')).toBe('user');
  });

  it('strips t_ / tbl_ prefixes when seeding modules', () => {
    const sql = `
      CREATE TABLE t_user (id BIGINT PRIMARY KEY);
      CREATE TABLE t_user_setting (id BIGINT PRIMARY KEY, user_id BIGINT, KEY idx_user (user_id));
    `;
    expect(moduleFor(sql, 't_user')).toBe('user');
    expect(moduleFor(sql, 't_user_setting')).toBe('user');
  });

  it('keeps parent-only tables (hubs) in their own module, not absorbed by children', () => {
    const sql = `
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT, KEY idx_user (user_id));
      CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
    `;
    // orders + order_items → 'order' module (size 2). users would have only inbound FK,
    // no outbound — it must stay in its own 'user' module.
    expect(moduleFor(sql, 'users')).toBe('user');
    expect(moduleFor(sql, 'orders')).toBe('order');
    expect(moduleFor(sql, 'order_items')).toBe('order');
  });

  it('pulls a singleton child into the larger anchor module via outbound FK', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY);
      CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
      CREATE TABLE shipments (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
    `;
    // shipments is a singleton 'shipment' module, but its only FK is into 'order' (size 2)
    // → it should get absorbed into 'order'.
    expect(moduleFor(sql, 'shipments')).toBe('order');
  });

  it('assigns palette colors deterministically based on module size', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY);
      CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
      CREATE TABLE users (id BIGINT PRIMARY KEY);
    `;
    const schema = parseSql(sql);
    const fks = [...schema.explicitForeignKeys, ...inferForeignKeys(schema)];
    const result = inferModules(schema, fks);
    expect(result.ordered[0].name).toBe('order'); // size 2 → first palette slot
    expect(result.ordered[0].color.header).toBe('#0c5788'); // professional/denim
    expect(result.ordered[1].name).toBe('user'); // singleton, second slot
    expect(result.ordered[1].color.header).toBe('#5b7328'); // professional/olive
  });

  it('professional palette ships an explicit dark-canvas step on every slot', () => {
    // headerDark is the hand-stepped dark-mode edge color; without it the edge
    // falls back to the automatic HSL lift, which the professional palette
    // must never do (its saturated darks would lift to neon).
    for (const slot of MODULE_PALETTES.professional) {
      expect(slot.headerDark).toMatch(/^#[0-9a-f]{6}$/);
      expect(slot.text).toBe('#ffffff');
    }
    // 12 distinct headers and 12 distinct dark steps — no accidental slot dupes.
    expect(new Set(MODULE_PALETTES.professional.map((s) => s.header)).size).toBe(12);
    expect(new Set(MODULE_PALETTES.professional.map((s) => s.headerDark)).size).toBe(12);
  });

  it('returns palette-specific colors when a non-default palette is requested', () => {
    const sql = `
      CREATE TABLE orders (id BIGINT PRIMARY KEY);
      CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT, KEY idx_order (order_id));
    `;
    const schema = parseSql(sql);
    const fks = [...schema.explicitForeignKeys, ...inferForeignKeys(schema)];
    const vibrant = inferModules(schema, fks, 'vibrant');
    const pastel = inferModules(schema, fks, 'pastel');
    const earth = inferModules(schema, fks, 'earth');
    const mono = inferModules(schema, fks, 'mono');

    expect(vibrant.ordered[0].color.header).toBe('#2563eb');
    // Each other palette's first slot is a distinct color from vibrant's first slot.
    expect(pastel.ordered[0].color.header).not.toBe(vibrant.ordered[0].color.header);
    expect(earth.ordered[0].color.header).not.toBe(vibrant.ordered[0].color.header);
    expect(mono.ordered[0].color.header).not.toBe(vibrant.ordered[0].color.header);
    // Module assignment is palette-independent — same table → same module key.
    expect(pastel.ordered[0].name).toBe(vibrant.ordered[0].name);
    expect(earth.ordered[0].tables).toEqual(vibrant.ordered[0].tables);
  });
});
