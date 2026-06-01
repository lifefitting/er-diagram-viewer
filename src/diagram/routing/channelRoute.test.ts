import { describe, it, expect } from 'vitest';
import {
  orthogonalize,
  segmentsFromPoints,
  segIntersectsRect,
  directOrthogonalRoute,
  detourRoute,
  dragSegment,
  reDockOverride,
  sideBracketRoute,
  buildObstacles,
  type Pt,
  type Rect,
} from './channelRoute';

const bends = (pts: Pt[]) => Math.max(0, pts.length - 2);
const routeIsClear = (pts: Pt[], r: Rect) =>
  pts.slice(1).every((_, i) => !segIntersectsRect(pts[i], pts[i + 1], r));

const isAxisAligned = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;

describe('orthogonalize', () => {
  it('emits only horizontal/vertical segments', () => {
    const out = orthogonalize([
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 200 },
    ]);
    for (let i = 1; i < out.length; i++) {
      expect(isAxisAligned(out[i - 1], out[i])).toBe(true);
    }
  });

  it('keeps endpoints and routes the vertical jog at the segment midpoint', () => {
    const out = orthogonalize([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 100, y: 50 });
    // jog at x=50
    expect(out.some((p) => Math.abs(p.x - 50) < 0.5)).toBe(true);
  });

  it('merges collinear runs', () => {
    const out = orthogonalize([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

describe('segmentsFromPoints', () => {
  it('produces the closed-form (w, d) for the canonical H-V-H 4-point path', () => {
    // dx=200, dy=100, L²=50000, L=√50000
    //  bend 1 = (mx, sy): w = dx²/(2·L²) = 0.4,  d = -dx·dy/(2·L) ≈ -44.72
    //  bend 2 = (mx, ty): w = (dx²+2·dy²)/(2·L²) = 0.6,  d = +44.72
    const pts: Pt[] = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
      { x: 210, y: 120 },
    ];
    const got = segmentsFromPoints(pts);
    expect(got.weights).toBe('0.4000 0.6000');
    expect(got.distances).toBe('-44.72 44.72');
  });

  it('degenerates to a straight line when there are no interior points', () => {
    expect(
      segmentsFromPoints([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual({
      weights: '0.5',
      distances: '0',
    });
  });
});

describe('segIntersectsRect', () => {
  const r: Rect = { x1: 40, y1: 40, x2: 60, y2: 60 };
  it('detects a segment crossing the interior', () => {
    expect(segIntersectsRect({ x: 0, y: 50 }, { x: 100, y: 50 }, r)).toBe(true);
  });
  it('ignores a segment that only grazes an edge', () => {
    expect(segIntersectsRect({ x: 0, y: 40 }, { x: 100, y: 40 }, r)).toBe(false);
  });
  it('ignores a segment that misses entirely', () => {
    expect(segIntersectsRect({ x: 0, y: 0 }, { x: 100, y: 0 }, r)).toBe(false);
  });
  // Vertical legs are exactly what directOrthogonalRoute parks in the gutter, so
  // lock the dx=0 (parallel-slab) branch on that axis too.
  it('detects a VERTICAL segment crossing the interior', () => {
    expect(segIntersectsRect({ x: 50, y: 0 }, { x: 50, y: 100 }, r)).toBe(true);
  });
  it('ignores a VERTICAL segment grazing an edge', () => {
    expect(segIntersectsRect({ x: 40, y: 0 }, { x: 40, y: 100 }, r)).toBe(false);
  });
  it('ignores a VERTICAL segment that misses', () => {
    expect(segIntersectsRect({ x: 10, y: 0 }, { x: 10, y: 100 }, r)).toBe(false);
  });
});

describe('buildObstacles', () => {
  it('excludes exactly the two endpoint cards', () => {
    const rects = new Map<string, Rect>([
      ['a', { x1: 0, y1: 0, x2: 1, y2: 1 }],
      ['b', { x1: 2, y1: 0, x2: 3, y2: 1 }],
      ['c', { x1: 4, y1: 0, x2: 5, y2: 1 }],
    ]);
    const out = buildObstacles(rects, 'a', 'c');
    expect(out).toEqual([{ x1: 2, y1: 0, x2: 3, y2: 1 }]); // only 'b' remains
  });
});

describe('directOrthogonalRoute', () => {
  it('returns a straight segment when ports share a y and nothing blocks', () => {
    expect(directOrthogonalRoute({ x: 0, y: 10 }, { x: 100, y: 10 }, [])).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
  });

  it('returns a 2-bend H-V-H with the vertical parked mid-gutter', () => {
    const out = directOrthogonalRoute({ x: 100, y: 0 }, { x: 0, y: 50 }, []);
    expect(out).not.toBeNull();
    expect(bends(out!)).toBe(2);
    // mid-gutter vertical at x = 50
    expect(
      out!.every(
        (p) => Math.abs(p.x - 50) < 0.5 || Math.abs(p.x - 100) < 0.5 || Math.abs(p.x) < 0.5,
      ),
    ).toBe(true);
    expect(out![0]).toEqual({ x: 100, y: 0 });
    expect(out![out!.length - 1]).toEqual({ x: 0, y: 50 });
  });

  it('sweeps to an off-center vertical when the mid-gutter is blocked', () => {
    // small obstacle straddling x=50 between the two port ys
    const obstacle: Rect = { x1: 45, y1: 20, x2: 55, y2: 30 };
    const out = directOrthogonalRoute({ x: 100, y: 0 }, { x: 0, y: 50 }, [obstacle]);
    expect(out).not.toBeNull();
    expect(bends(out!)).toBe(2);
    // The whole returned polyline (both horizontals + the vertical) must clear
    // the obstacle, not merely dodge its x-band.
    expect(routeIsClear(out!, obstacle)).toBe(true);
  });

  it('returns a route clear of an obstacle that blocks a HORIZONTAL leg', () => {
    // sits on the y=0 (source) horizontal leg, near the child port
    const obstacle: Rect = { x1: 70, y1: -5, x2: 90, y2: 5 };
    const out = directOrthogonalRoute({ x: 100, y: 0 }, { x: 0, y: 50 }, [obstacle]);
    if (out) expect(routeIsClear(out, obstacle)).toBe(true);
    // (null is also acceptable — it means no clean 2-bend route exists)
  });

  it('gives up (null) when the same-y straight path is blocked', () => {
    const wall: Rect = { x1: 40, y1: 5, x2: 60, y2: 15 };
    expect(directOrthogonalRoute({ x: 0, y: 10 }, { x: 100, y: 10 }, [wall])).toBeNull();
  });

  it('gives up (null) when an obstacle spans the whole gutter', () => {
    const wall: Rect = { x1: 5, y1: -100, x2: 95, y2: 100 };
    expect(directOrthogonalRoute({ x: 100, y: 0 }, { x: 0, y: 50 }, [wall])).toBeNull();
  });
});

describe('dragSegment (polyline editing)', () => {
  it('shifts an interior VERTICAL segment horizontally, ports pinned', () => {
    const route: Pt[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ];
    const out = dragSegment(route, 1, { x: 20, y: 0 }); // segment b1-b2 is vertical
    expect(out[0]).toEqual({ x: 0, y: 0 }); // src port fixed
    expect(out[out.length - 1]).toEqual({ x: 100, y: 40 }); // tgt port fixed
    expect(out[1]).toEqual({ x: 70, y: 0 });
    expect(out[2]).toEqual({ x: 70, y: 40 });
    for (let i = 1; i < out.length; i++) expect(isAxisAligned(out[i - 1], out[i])).toBe(true);
  });

  it('shifts an interior HORIZONTAL segment vertically, ports pinned', () => {
    const route: Pt[] = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 80 },
    ];
    const out = dragSegment(route, 1, { x: 0, y: 15 }); // segment b1-b2 is horizontal
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 60, y: 80 });
    expect(out[1]).toEqual({ x: 0, y: 55 });
    expect(out[2]).toEqual({ x: 60, y: 55 });
  });

  it('is a no-op for a port-adjacent segment (never moves a port)', () => {
    const route: Pt[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ];
    expect(dragSegment(route, 0, { x: 20, y: 20 })).toEqual(route); // first leg
    expect(dragSegment(route, 2, { x: 20, y: 20 })).toEqual(route); // last leg
  });
});

describe('reDockOverride', () => {
  it('keeps the interior bends and re-docks to the live ports (orthogonal)', () => {
    const out = reDockOverride(
      [
        { x: 50, y: 0 },
        { x: 50, y: 40 },
      ],
      { x: 10, y: 0 },
      { x: 90, y: 40 },
    );
    expect(out).not.toBeNull();
    expect(out![0]).toEqual({ x: 10, y: 0 });
    expect(out![out!.length - 1]).toEqual({ x: 90, y: 40 });
    for (let i = 1; i < out!.length; i++) expect(isAxisAligned(out![i - 1], out![i])).toBe(true);
  });

  it('returns null when the ports coincide (degenerate route)', () => {
    expect(reDockOverride([{ x: 5, y: 5 }], { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('detourRoute', () => {
  it('routes a clean orthogonal path around a card blocking a same-y straight run', () => {
    const card: Rect = { x1: 80, y1: -20, x2: 120, y2: 20 };
    // Same-y ports with a card straddling the straight line → direct gives up.
    expect(directOrthogonalRoute({ x: 200, y: 0 }, { x: 0, y: 0 }, [card])).toBeNull();
    const out = detourRoute({ x: 200, y: 0 }, { x: 0, y: 0 }, [card]);
    expect(out).not.toBeNull();
    for (let i = 1; i < out!.length; i++) {
      expect(isAxisAligned(out![i - 1], out![i])).toBe(true);
    }
    expect(routeIsClear(out!, card)).toBe(true);
    // Port-docking invariant: first === src, last === tgt (routePoints/SVG rely on it).
    expect(out![0]).toEqual({ x: 200, y: 0 });
    expect(out![out!.length - 1]).toEqual({ x: 0, y: 0 });
    expect(bends(out!)).toBeGreaterThanOrEqual(2);
  });

  it('routes around an obstacle that spans the whole gutter (where direct gives up)', () => {
    const wall: Rect = { x1: 60, y1: -60, x2: 140, y2: 60 };
    expect(directOrthogonalRoute({ x: 200, y: 0 }, { x: 0, y: 30 }, [wall])).toBeNull();
    const out = detourRoute({ x: 200, y: 0 }, { x: 0, y: 30 }, [wall]);
    expect(out).not.toBeNull();
    expect(routeIsClear(out!, wall)).toBe(true);
    for (let i = 1; i < out!.length; i++) {
      expect(isAxisAligned(out![i - 1], out![i])).toBe(true);
    }
    expect(out![0]).toEqual({ x: 200, y: 0 });
    expect(out![out!.length - 1]).toEqual({ x: 0, y: 30 });
  });

  it('is deterministic for identical inputs (stable tie-break → no frame flicker)', () => {
    const obs: Rect[] = [
      { x1: 80, y1: -40, x2: 120, y2: 40 },
      { x1: 80, y1: 80, x2: 120, y2: 160 },
    ];
    const a = detourRoute({ x: 220, y: 0 }, { x: 0, y: 100 }, obs);
    const b = detourRoute({ x: 220, y: 0 }, { x: 0, y: 100 }, obs);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it('returns null only when the ports are fully boxed in', () => {
    // One obstacle engulfing both ports → no orthogonal way out (last-resort).
    const engulf: Rect = { x1: -500, y1: -500, x2: 500, y2: 500 };
    expect(detourRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [engulf])).toBeNull();
  });
});

describe('sideBracketRoute (vertically-stacked cards)', () => {
  const srcSpan = { left: 100, right: 300 };
  const tgtSpan = { left: 120, right: 320 };

  it('routes a 2-bend bracket with both ports on the same (left) side', () => {
    const out = sideBracketRoute(0, 200, srcSpan, tgtSpan, 30, []);
    expect(out).not.toBeNull();
    expect(out!.side).toBe('left');
    expect(bends(out!.points)).toBe(2);
    // both ports dock on the left edges; vertical leg parked left of both cards
    expect(out!.points[0]).toEqual({ x: 100, y: 0 });
    expect(out!.points[out!.points.length - 1]).toEqual({ x: 120, y: 200 });
    expect(out!.points[1].x).toBe(70); // min(left) - margin
    expect(out!.points[2].x).toBe(70);
  });

  it('falls to the right side when the left margin is blocked', () => {
    const blockLeft: Rect = { x1: 60, y1: 50, x2: 80, y2: 150 };
    const out = sideBracketRoute(0, 200, srcSpan, tgtSpan, 30, [blockLeft]);
    expect(out).not.toBeNull();
    expect(out!.side).toBe('right');
    expect(out!.points[1].x).toBe(350); // max(right) + margin
  });

  it('returns null when both side margins are blocked', () => {
    const blockLeft: Rect = { x1: 60, y1: -100, x2: 80, y2: 300 };
    const blockRight: Rect = { x1: 340, y1: -100, x2: 360, y2: 300 };
    expect(sideBracketRoute(0, 200, srcSpan, tgtSpan, 30, [blockLeft, blockRight])).toBeNull();
  });
});
