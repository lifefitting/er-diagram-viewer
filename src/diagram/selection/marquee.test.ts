import { describe, it, expect } from 'vitest';
import type { NodePos } from '../types';
import { normalizeRect, rectsIntersect, nodesInMarquee, polylineIntersectsRect } from './marquee';

/** Minimal NodePos: nodesInMarquee only reads id/x/y/w/h. */
function pos(id: string, x: number, y: number, w: number, h: number): NodePos {
  return { id, x, y, w, h } as unknown as NodePos;
}

describe('normalizeRect', () => {
  it('is direction-agnostic (drag up-left equals drag down-right)', () => {
    const downRight = normalizeRect({ x: 10, y: 20 }, { x: 50, y: 80 });
    const upLeft = normalizeRect({ x: 50, y: 80 }, { x: 10, y: 20 });
    expect(downRight).toEqual({ x: 10, y: 20, w: 40, h: 60 });
    expect(upLeft).toEqual(downRight);
  });

  it('produces a zero-size rect for a point', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe('rectsIntersect', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };

  it('detects overlap', () => {
    expect(rectsIntersect(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
  });

  it('treats a shared edge (touch) as intersecting', () => {
    expect(rectsIntersect(a, { x: 100, y: 0, w: 20, h: 20 })).toBe(true);
  });

  it('returns false when fully separated', () => {
    expect(rectsIntersect(a, { x: 101, y: 0, w: 20, h: 20 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 101, w: 20, h: 20 })).toBe(false);
  });

  it('contains is a special case of intersect', () => {
    expect(rectsIntersect(a, { x: 20, y: 20, w: 10, h: 10 })).toBe(true);
  });
});

describe('nodesInMarquee', () => {
  const nodes = [
    pos('t:a', 0, 0, 50, 50),
    pos('t:b', 200, 0, 50, 50),
    pos('t:c', 100, 100, 60, 60),
  ];

  it('selects only the cards the box overlaps', () => {
    // Box covering the top-left area: hits a, grazes c's top-left corner? c is
    // at (100,100) so a box of (0,0,120,120) reaches it.
    expect(nodesInMarquee(nodes, { x: 0, y: 0, w: 60, h: 60 })).toEqual(['t:a']);
  });

  it('selects multiple cards when the box spans them', () => {
    expect(nodesInMarquee(nodes, { x: 0, y: 0, w: 260, h: 60 })).toEqual(['t:a', 't:b']);
  });

  it('selects a card on edge-touch', () => {
    // Box right edge lands exactly on b's left edge (x=200).
    expect(nodesInMarquee(nodes, { x: 150, y: 0, w: 50, h: 20 })).toEqual(['t:b']);
  });

  it('returns empty when the box misses everything', () => {
    expect(nodesInMarquee(nodes, { x: 400, y: 400, w: 10, h: 10 })).toEqual([]);
  });
});

describe('polylineIntersectsRect (连线框选)', () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };

  it('vertex inside the box counts', () => {
    expect(polylineIntersectsRect([{ x: 0, y: 0 }, { x: 150, y: 150 }], box)).toBe(true);
  });

  it('segment sweeping straight through counts (no vertex inside)', () => {
    expect(polylineIntersectsRect([{ x: 0, y: 150 }, { x: 300, y: 150 }], box)).toBe(true);
  });

  it('polyline entirely outside does not count', () => {
    expect(
      polylineIntersectsRect(
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 300 },
        ],
        box,
      ),
    ).toBe(false);
  });

  it('grazing the box edge counts (touch = selected)', () => {
    expect(polylineIntersectsRect([{ x: 100, y: 0 }, { x: 100, y: 300 }], box)).toBe(true);
  });
});
