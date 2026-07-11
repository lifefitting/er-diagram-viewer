import { describe, it, expect } from 'vitest';
import type { Column, ForeignKey, Schema, Table } from '../parser/types';
import {
  buildElements,
  buildFkSourceColumns,
  columnRowOffsets,
  tableBoxSize,
  HEADER_HEIGHT,
  ROW_BORDER,
  FIELD_ROW_HEIGHT,
  type BuildDisplayOpts,
} from './buildGraph';
import { inferModules } from '../infer/inferModules';

const col = (name: string, over: Partial<Column> = {}): Column => ({
  name,
  rawType: 'int',
  normalizedType: 'int',
  nullable: false,
  isPrimaryKey: false,
  isUnique: false,
  hasIndex: false,
  isAutoIncrement: false,
  ...over,
});

const table = (name: string, columns: Column[], primaryKey: string[] = []): Table => ({
  name,
  columns,
  primaryKey,
  indexes: [],
});

const DISPLAY: BuildDisplayOpts = { showComment: false, showType: true };

function schemaOf(tables: Table[]): Schema {
  return { tables, explicitForeignKeys: [], warnings: [] };
}

function edgeFkKeysBySource(schema: Schema, fks: ForeignKey[]): Record<string, string> {
  const { elements } = buildElements(schema, fks, {
    modules: inferModules(schema, fks),
    collapsed: {},
    tableWidths: {},
    display: DISPLAY,
    decisions: {},
  });
  const out: Record<string, string> = {};
  for (const el of elements) {
    if (el.group !== 'edges') continue;
    const meta = el.data.meta as { source: string };
    out[meta.source] = el.data.fkKey as string;
  }
  return out;
}

describe('buildElements fkKey stability (finding 1)', () => {
  const schema = schemaOf([
    table('users', [col('id', { isPrimaryKey: true })], ['id']),
    table('orders', [col('id', { isPrimaryKey: true }), col('user_id')], ['id']),
  ]);

  // Two FKs that collide on canonicalFkKey (same lowercased column-pair) but
  // differ by source — the realistic explicit+inferred / shard-case collision.
  const fkExplicit: ForeignKey = {
    fromTable: 'orders',
    fromColumns: ['user_id'],
    toTable: 'users',
    toColumns: ['id'],
    source: 'explicit',
  };
  const fkInferred: ForeignKey = {
    fromTable: 'orders',
    fromColumns: ['user_id'],
    toTable: 'users',
    toColumns: ['id'],
    source: 'inferred',
    confidence: 'medium',
  };

  it('gives colliding edges distinct keys', () => {
    const keys = edgeFkKeysBySource(schema, [fkExplicit, fkInferred]);
    expect(keys.explicit).not.toEqual(keys.inferred);
  });

  it('keeps each logical edge key stable when the FK order is reversed', () => {
    const forward = edgeFkKeysBySource(schema, [fkExplicit, fkInferred]);
    const reversed = edgeFkKeysBySource(schema, [fkInferred, fkExplicit]);
    // The key is derived from the FK's own content, not its position, so the
    // same logical edge resolves to the same fkKey regardless of ordering —
    // which is what lets a hand-edited route survive a rebuild that reorders.
    expect(reversed.explicit).toEqual(forward.explicit);
    expect(reversed.inferred).toEqual(forward.inferred);
  });

  it('keeps the bare canonical key for a unique (non-colliding) FK', () => {
    const keys = edgeFkKeysBySource(schema, [fkExplicit]);
    expect(keys.explicit).toBe('orders.user_id->users.id');
  });
});

describe('logical (business-key) edges', () => {
  const schema = schemaOf([
    table('orders', [col('id', { isPrimaryKey: true }), col('out_no')], ['id']),
    table('payments', [col('id', { isPrimaryKey: true }), col('out_no')], ['id']),
  ]);
  const logical: ForeignKey = {
    fromTable: 'orders',
    fromColumns: ['out_no'],
    toTable: 'payments',
    toColumns: ['out_no'],
    source: 'inferred',
    kind: 'logical',
    confidence: 'medium',
  };

  it('propagates kind onto edge data and meta', () => {
    const { elements } = buildElements(schema, [logical], {
      modules: inferModules(schema, [logical]),
      collapsed: {},
      tableWidths: {},
      display: DISPLAY,
      decisions: {},
    });
    const edge = elements.find((el) => el.group === 'edges')!;
    expect(edge.data.kind).toBe('logical');
    expect((edge.data.meta as { kind: string }).kind).toBe('logical');
  });

  it('excludes logical endpoints from the FK badge columns', () => {
    const map = buildFkSourceColumns([logical]);
    expect(map.size).toBe(0);
  });
});

describe('onlyPk box sizing & row offsets (finding 2)', () => {
  const orders = table(
    'orders',
    [col('id', { isPrimaryKey: true }), col('user_id'), col('total')],
    ['id'],
  );
  // PK is NOT the first column here, to prove the visible row gets packed to the
  // top regardless of its full-column index.
  const events = table('events', [col('payload'), col('id', { isPrimaryKey: true })], ['id']);

  const FIRST_ROW_Y = HEADER_HEIGHT + ROW_BORDER + FIELD_ROW_HEIGHT / 2;

  it('returns one offset per column, NaN for columns hidden in onlyPk mode', () => {
    const offs = columnRowOffsets(orders, { ...DISPLAY, onlyPk: true });
    expect(offs).toHaveLength(3);
    expect(Number.isFinite(offs[0])).toBe(true); // id (PK) visible
    expect(Number.isNaN(offs[1])).toBe(true); // user_id hidden
    expect(Number.isNaN(offs[2])).toBe(true); // total hidden
  });

  it('packs the visible PK row to the top even when it is not column 0', () => {
    const offs = columnRowOffsets(events, { ...DISPLAY, onlyPk: true });
    expect(Number.isNaN(offs[0])).toBe(true); // payload hidden
    expect(offs[1]).toBe(FIRST_ROW_Y); // id packed to the first row slot
  });

  it('matches full-mode offsets when onlyPk is off', () => {
    const full = columnRowOffsets(orders, DISPLAY);
    expect(full.every((v) => Number.isFinite(v))).toBe(true);
    expect(full[0]).toBe(FIRST_ROW_Y);
  });

  it('shrinks the card height by exactly the hidden rows', () => {
    const full = tableBoxSize(orders, false, DISPLAY, '');
    const pk = tableBoxSize(orders, false, { ...DISPLAY, onlyPk: true }, '');
    // 2 of 3 columns hidden → drop two (border + row) blocks.
    expect(full.height - pk.height).toBe(2 * (ROW_BORDER + FIELD_ROW_HEIGHT));
  });
});
