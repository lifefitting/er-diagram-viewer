import { describe, it, expect } from 'vitest';
import { sanitizePersisted, migratePersisted } from './persistMigrate';

describe('sanitizePersisted (P2 #5 — shape guard on every load)', () => {
  const valid = {
    rawSql: 'CREATE TABLE a (id INT);',
    palette: 'vibrant',
    theme: 'dark',
    sidebarCollapsed: true,
    decisions: { 'a.x->b.y': 'accept' },
    display: {
      onlyPk: false,
      showType: true,
      showComment: true,
      showIndex: true,
      showLowConfidence: false,
      showLogicalLinks: true,
      showManualLinks: true,
    },
    collapsed: { a: true },
    tableWidths: { a: 320 },
    deletedTables: { 't:b': true },
    nodePositions: { 't:a': { x: 10, y: 20 } },
    manualRoutes: {
      'a.x->b.y': [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    },
    viewport: { x: -100, y: 50, zoom: 1.5 },
  };

  it('passes a fully valid payload through unchanged', () => {
    expect(sanitizePersisted(valid)).toEqual(valid);
  });

  it('drops malformed nodePositions (non-numeric coord)', () => {
    const out = sanitizePersisted({ ...valid, nodePositions: { 't:a': { x: 'nope', y: 20 } } });
    expect('nodePositions' in out).toBe(false); // → slice default {}
    expect(out.rawSql).toBe(valid.rawSql); // siblings survive
  });

  it('drops a viewport with a non-finite zoom but keeps an explicit null', () => {
    expect('viewport' in sanitizePersisted({ ...valid, viewport: { x: 1, y: 2, zoom: NaN } })).toBe(
      false,
    );
    expect(sanitizePersisted({ ...valid, viewport: null }).viewport).toBeNull();
  });

  it('drops manualRoutes whose values are not point arrays', () => {
    expect('manualRoutes' in sanitizePersisted({ ...valid, manualRoutes: { k: 'x,y' } })).toBe(
      false,
    );
    expect('manualRoutes' in sanitizePersisted({ ...valid, manualRoutes: { k: [{ x: 1 }] } })).toBe(
      false,
    );
  });

  it('keeps well-formed manualFks and drops malformed ones', () => {
    const fk = {
      fromTable: 'check_task_detail',
      fromColumns: ['task_id'],
      toTable: 'check_task',
      toColumns: ['id'],
      source: 'manual',
    };
    expect(sanitizePersisted({ ...valid, manualFks: [fk] }).manualFks).toEqual([fk]);
    // optional kind: absent and known values pass, junk drops the field
    expect(
      sanitizePersisted({ ...valid, manualFks: [{ ...fk, kind: 'logical' }] }).manualFks,
    ).toEqual([{ ...fk, kind: 'logical' }]);
    expect(
      'manualFks' in sanitizePersisted({ ...valid, manualFks: [{ ...fk, kind: 'sideways' }] }),
    ).toBe(false);
    // wrong source tag
    expect(
      'manualFks' in sanitizePersisted({ ...valid, manualFks: [{ ...fk, source: 'inferred' }] }),
    ).toBe(false);
    // empty column list / missing table
    expect(
      'manualFks' in sanitizePersisted({ ...valid, manualFks: [{ ...fk, fromColumns: [] }] }),
    ).toBe(false);
    expect(
      'manualFks' in sanitizePersisted({ ...valid, manualFks: [{ ...fk, toTable: '' }] }),
    ).toBe(false);
    // not an array
    expect('manualFks' in sanitizePersisted({ ...valid, manualFks: { 0: fk } })).toBe(false);
  });

  it('keeps valid fieldNotes (upgrading legacy shapes) and drops malformed ones', () => {
    const note = {
      text: '建议改枚举',
      updatedAt: '2026-07-11T10:00:00.000Z',
      severity: 'warn',
      status: 'accepted',
    };
    expect(
      sanitizePersisted({ ...valid, fieldNotes: { 'orders::status': note } }).fieldNotes,
    ).toEqual({ 'orders::status': note });
    // Legacy pre-timestamp snapshot: plain string → wrapped, defaults 建议/待处理.
    expect(
      sanitizePersisted({ ...valid, fieldNotes: { 'orders::status': '建议改枚举' } }).fieldNotes,
    ).toEqual({
      'orders::status': { text: '建议改枚举', updatedAt: '', severity: 'suggest', status: 'open' },
    });
    // Legacy pre-severity/status object → upgraded with the same defaults.
    expect(
      sanitizePersisted({
        ...valid,
        fieldNotes: { 'orders::status': { text: '建议改枚举', updatedAt: '' } },
      }).fieldNotes,
    ).toEqual({
      'orders::status': { text: '建议改枚举', updatedAt: '', severity: 'suggest', status: 'open' },
    });
    expect('fieldNotes' in sanitizePersisted({ ...valid, fieldNotes: { k: '' } })).toBe(false);
    expect('fieldNotes' in sanitizePersisted({ ...valid, fieldNotes: { k: 3 } })).toBe(false);
    expect('fieldNotes' in sanitizePersisted({ ...valid, fieldNotes: { k: { text: '' } } })).toBe(
      false,
    );
    // Out-of-domain severity / status values invalidate the whole map.
    expect(
      'fieldNotes' in
        sanitizePersisted({ ...valid, fieldNotes: { k: { text: 'x', severity: 'critical' } } }),
    ).toBe(false);
    expect(
      'fieldNotes' in
        sanitizePersisted({ ...valid, fieldNotes: { k: { text: 'x', status: 'done' } } }),
    ).toBe(false);
  });

  it('keeps a valid logicalKeys list and drops malformed ones', () => {
    expect(sanitizePersisted({ ...valid, logicalKeys: ['out_trade_no'] }).logicalKeys).toEqual([
      'out_trade_no',
    ]);
    expect(sanitizePersisted({ ...valid, logicalKeys: [] }).logicalKeys).toEqual([]);
    expect('logicalKeys' in sanitizePersisted({ ...valid, logicalKeys: ['a', 3] })).toBe(false);
    expect('logicalKeys' in sanitizePersisted({ ...valid, logicalKeys: 'out_trade_no' })).toBe(
      false,
    );
  });

  it('drops an invalid theme / palette / partial display', () => {
    expect('theme' in sanitizePersisted({ ...valid, theme: 'neon' })).toBe(false);
    expect('palette' in sanitizePersisted({ ...valid, palette: 'rainbow' })).toBe(false);
    expect(sanitizePersisted({ ...valid, palette: 'professional' }).palette).toBe('professional');
    expect('display' in sanitizePersisted({ ...valid, display: { onlyPk: true } })).toBe(false);
  });

  it('drops decisions with an out-of-domain value', () => {
    expect('decisions' in sanitizePersisted({ ...valid, decisions: { k: 'maybe' } })).toBe(false);
  });

  it('returns an empty object for non-object input', () => {
    expect(sanitizePersisted(null)).toEqual({});
    expect(sanitizePersisted('garbage')).toEqual({});
    expect(sanitizePersisted(42)).toEqual({});
  });
});

describe('migratePersisted (P2 #5 — version-mismatch drop)', () => {
  it('drops an old (v1) snapshot down to its rawSql', () => {
    const v1 = {
      rawSql: 'CREATE TABLE a (id INT);',
      decisions: { 'A.X->B.Y': 'accept' }, // old case-preserving keys → must not survive
      nodePositions: { 't:a': { x: 1, y: 2 } },
      viewport: { x: 1, y: 2, zoom: 1 },
    };
    expect(migratePersisted(v1, 1)).toEqual({ rawSql: v1.rawSql });
  });

  it('yields an empty rawSql when none present, and {} for non-object input', () => {
    expect(migratePersisted({ decisions: {} }, 0)).toEqual({ rawSql: '' });
    expect(migratePersisted(null, 1)).toEqual({});
  });
});
