import { describe, expect, it } from 'vitest';
import { countCrossings, countOverlaps } from './routeMetrics';
import type { Pt } from './channelRoute';

const route = (...pts: Array<[number, number]>): Pt[] => pts.map(([x, y]) => ({ x, y }));

describe('countCrossings', () => {
  it('counts a proper H×V crossing between two routes', () => {
    // Route A: horizontal line y=50 from x=0..100.
    // Route B: vertical line x=50 from y=0..100.
    const a = route([0, 50], [100, 50]);
    const b = route([50, 0], [50, 100]);
    expect(countCrossings([a, b])).toBe(1);
  });

  it('does not count T-junction touches or same-route bends', () => {
    // B's vertical ENDS on A's horizontal (touch, not cross).
    const a = route([0, 50], [100, 50]);
    const touch = route([50, 0], [50, 50]);
    expect(countCrossings([a, touch])).toBe(0);
    // A single route's own bend never counts.
    const l = route([0, 0], [50, 0], [50, 50]);
    expect(countCrossings([l])).toBe(0);
  });

  it('counts each crossing pair once per pair of segments', () => {
    // One vertical crossed by two separate horizontals from another route
    // is two crossings.
    const v = route([50, 0], [50, 100]);
    const zigzag = route([0, 30], [100, 30], [100, 60], [0, 60]);
    expect(countCrossings([v, zigzag])).toBe(2);
  });
});

describe('countOverlaps', () => {
  it('counts two coincident vertical segments as one overlap', () => {
    const a = route([0, 0], [50, 0], [50, 100], [100, 100]);
    const b = route([0, 20], [50, 20], [50, 80], [100, 80]);
    expect(countOverlaps([a, b])).toBe(1);
  });

  it('ignores parallel segments separated by more than the tolerance', () => {
    const a = route([50, 0], [50, 100]);
    const b = route([58, 0], [58, 100]);
    expect(countOverlaps([a, b])).toBe(0);
  });

  it('ignores collinear segments that only touch end-to-end', () => {
    const a = route([50, 0], [50, 50]);
    const b = route([50, 50], [50, 100]);
    expect(countOverlaps([a, b])).toBe(0);
  });

  it('counts horizontal overlaps too', () => {
    const a = route([0, 40], [100, 40]);
    const b = route([60, 40], [200, 40]);
    expect(countOverlaps([a, b])).toBe(1);
  });
});
