import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindView,
  unbindView,
  getView,
  onViewChange,
  bindHistory,
  unbindHistory,
  seedHistory,
  resetHistory,
  pushHistory,
  undo,
  redo,
  getIsApplying,
  type CyView,
  type LayoutSnapshot,
} from './cyHandle';

const snap = (id: string, x: number): LayoutSnapshot => ({
  positions: { [id]: { x, y: 0 } },
  widths: {},
  routes: {},
});

describe('cyHandle history', () => {
  let applied: LayoutSnapshot[];
  let flags: { u: boolean; r: boolean };

  beforeEach(() => {
    applied = [];
    flags = { u: false, r: false };
    unbindHistory();
    resetHistory();
    bindHistory(
      (s) => applied.push(s),
      (u, r) => {
        flags = { u, r };
      },
    );
  });

  it('seed establishes a baseline with no undo step', () => {
    seedHistory(snap('a', 0));
    undo();
    expect(applied).toHaveLength(0); // nothing to undo
    expect(flags).toEqual({ u: false, r: false });
  });

  it('push makes the previous state undoable; undo restores it', () => {
    seedHistory(snap('a', 0));
    pushHistory(snap('a', 10));
    expect(flags).toEqual({ u: true, r: false });
    undo();
    expect(applied).toEqual([snap('a', 0)]);
    expect(flags).toEqual({ u: false, r: true });
  });

  it('redo re-applies the undone state', () => {
    seedHistory(snap('a', 0));
    pushHistory(snap('a', 10));
    undo();
    redo();
    expect(applied).toEqual([snap('a', 0), snap('a', 10)]);
    expect(flags).toEqual({ u: true, r: false });
  });

  it('a fresh push after undo clears the redo branch', () => {
    seedHistory(snap('a', 0));
    pushHistory(snap('a', 10));
    undo(); // back at 0, redo available
    expect(flags.r).toBe(true);
    pushHistory(snap('a', 5)); // new branch from 0
    expect(flags).toEqual({ u: true, r: false });
    redo(); // no-op — redo branch was discarded
    expect(applied).toEqual([snap('a', 0)]);
  });

  it('resetHistory clears both stacks', () => {
    seedHistory(snap('a', 0));
    pushHistory(snap('a', 10));
    pushHistory(snap('a', 20));
    resetHistory();
    expect(flags).toEqual({ u: false, r: false });
    undo();
    redo();
    expect(applied).toHaveLength(0);
  });

  it('getIsApplying is true only during an apply', () => {
    const seen: boolean[] = [];
    unbindHistory();
    bindHistory(
      () => seen.push(getIsApplying()),
      () => {},
    );
    seedHistory(snap('a', 0));
    pushHistory(snap('a', 10));
    undo();
    expect(seen).toEqual([true]);
    expect(getIsApplying()).toBe(false);
  });
});

describe('cyHandle view binding notifications', () => {
  const makeView = (zoom: number): CyView => ({
    cy: null,
    relayout: () => {},
    fit: () => {},
    resetZoom: () => {},
    zoomToSelection: () => {},
    centerOnNode: () => {},
    getZoom: () => zoom,
    onZoomChange: () => () => {},
  });

  beforeEach(() => {
    unbindView();
  });

  it('notifies subscribers on bind and unbind', () => {
    const seen: Array<CyView | null> = [];
    const unsub = onViewChange((v) => seen.push(v));
    const v1 = makeView(1);
    bindView(v1);
    unbindView();
    unsub();
    expect(seen).toEqual([v1, null]);
  });

  it('a REBIND (canvas remount under a live consumer) delivers the fresh view', () => {
    // The workspaceEpoch remount: unbind old canvas → bind new one, while
    // CanvasControls stays mounted. Its zoom readout must follow the new view
    // instead of staying subscribed to the destroyed cy instance.
    const v1 = makeView(1);
    const v2 = makeView(0.64);
    bindView(v1);

    let current: CyView | null = getView();
    const unsub = onViewChange((v) => {
      current = v;
    });

    unbindView(); // old canvas unmounts
    bindView(v2); // new canvas mounts
    expect(current).toBe(v2);
    expect(current!.getZoom()).toBe(0.64);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const seen: Array<CyView | null> = [];
    const unsub = onViewChange((v) => seen.push(v));
    unsub();
    bindView(makeView(2));
    expect(seen).toEqual([]);
    unbindView();
  });
});
