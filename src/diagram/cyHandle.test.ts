import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindHistory,
  unbindHistory,
  seedHistory,
  resetHistory,
  pushHistory,
  undo,
  redo,
  getIsApplying,
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
