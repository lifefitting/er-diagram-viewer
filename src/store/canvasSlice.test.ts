import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './index';

const SQL = 'CREATE TABLE a (id BIGINT PRIMARY KEY);\nCREATE TABLE b (id BIGINT PRIMARY KEY);';

describe('collapseAll excludes recycle-binned tables (finding 5)', () => {
  beforeEach(() => {
    useApp.getState().setSql(SQL); // fresh import: clears collapsed/deleted/etc.
  });

  it('collapses only tables on the canvas', () => {
    useApp.getState().deleteTables(['t:b']); // recycle-bin table b (keyed by node id)
    const decision = useApp.getState().deletedTables['t:b'];
    expect(decision.action).toBe('delete');
    expect(Number.isNaN(new Date(decision.updatedAt).getTime())).toBe(false);
    useApp.getState().collapseAll();
    const collapsed = useApp.getState().collapsed;
    expect(collapsed.a).toBe(true);
    expect('b' in collapsed).toBe(false); // hidden table must not gain a collapse entry
  });

  it('collapses every table when none are hidden', () => {
    useApp.getState().collapseAll();
    expect(useApp.getState().collapsed).toEqual({ a: true, b: true });
  });
});

describe('setManualRoute rejects degenerate routes (finding 6)', () => {
  beforeEach(() => {
    useApp.setState({ manualRoutes: {} });
  });

  it('ignores an empty points array (no dead entry persisted)', () => {
    useApp.getState().setManualRoute('k', []);
    expect('k' in useApp.getState().manualRoutes).toBe(false);
  });

  it('ignores a single-point (sub-route) array', () => {
    useApp.getState().setManualRoute('k', [{ x: 1, y: 2 }]);
    expect('k' in useApp.getState().manualRoutes).toBe(false);
  });

  it('ignores a route with non-finite coords', () => {
    useApp.getState().setManualRoute('k', [
      { x: NaN, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect('k' in useApp.getState().manualRoutes).toBe(false);
  });

  it('stores a valid 2+ point finite route (rounded to 1dp)', () => {
    useApp.getState().setManualRoute('k', [
      { x: 0.04, y: 0 },
      { x: 1.26, y: 2 },
    ]);
    expect(useApp.getState().manualRoutes.k).toEqual([
      { x: 0, y: 0 },
      { x: 1.3, y: 2 },
    ]);
  });
});
