import { describe, it, expect } from 'vitest';
import { sanitizePersisted, migratePersisted } from './persistMigrate';

describe('sanitizePersisted (P2 #5 — shape guard on every load)', () => {
  const valid = {
    rawSql: 'CREATE TABLE a (id INT);',
    palette: 'vibrant',
    theme: 'dark',
    sidebarCollapsed: true,
    decisions: { 'a.x->b.y': 'accept' },
    display: { onlyPk: false, showType: true, showComment: true, showIndex: true, showLowConfidence: false },
    collapsed: { a: true },
    tableWidths: { a: 320 },
    deletedTables: { 't:b': true },
    nodePositions: { 't:a': { x: 10, y: 20 } },
    manualRoutes: { 'a.x->b.y': [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
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
    expect('viewport' in sanitizePersisted({ ...valid, viewport: { x: 1, y: 2, zoom: NaN } })).toBe(false);
    expect(sanitizePersisted({ ...valid, viewport: null }).viewport).toBeNull();
  });

  it('drops manualRoutes whose values are not point arrays', () => {
    expect('manualRoutes' in sanitizePersisted({ ...valid, manualRoutes: { k: 'x,y' } })).toBe(false);
    expect('manualRoutes' in sanitizePersisted({ ...valid, manualRoutes: { k: [{ x: 1 }] } })).toBe(false);
  });

  it('drops an invalid theme / palette / partial display', () => {
    expect('theme' in sanitizePersisted({ ...valid, theme: 'neon' })).toBe(false);
    expect('palette' in sanitizePersisted({ ...valid, palette: 'rainbow' })).toBe(false);
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
