import { describe, expect, it } from 'vitest';
import { assignTracks, MIN_SEP, TRACK_GAP, type TrackRoute } from './assignTracks';
import type { Pt, Rect } from './channelRoute';

const route = (...pts: Array<[number, number]>): Pt[] => pts.map(([x, y]) => ({ x, y }));

/** x of the interior vertical of a 4-point H-V-H route. */
const vx = (pts: Pt[]): number => pts[1].x;

describe('assignTracks', () => {
  it('separates two coincident verticals with overlapping spans', () => {
    // Both H-V-H routes park their vertical at x=200 and overlap in y.
    const a: TrackRoute = { pts: route([0, 0], [200, 0], [200, 100], [400, 100]), movable: true };
    const b: TrackRoute = { pts: route([0, 40], [200, 40], [200, 160], [400, 160]), movable: true };
    assignTracks([a, b]);
    expect(Math.abs(vx(a.pts) - vx(b.pts))).toBeGreaterThanOrEqual(MIN_SEP);
    // Ports never move.
    expect(a.pts[0]).toEqual({ x: 0, y: 0 });
    expect(a.pts[a.pts.length - 1]).toEqual({ x: 400, y: 100 });
  });

  it('leaves coincident verticals alone when their spans do not overlap', () => {
    const a: TrackRoute = { pts: route([0, 0], [200, 0], [200, 90], [400, 90]), movable: true };
    const b: TrackRoute = { pts: route([0, 200], [200, 200], [200, 300], [400, 300]), movable: true };
    assignTracks([a, b]);
    expect(vx(a.pts)).toBe(200);
    expect(vx(b.pts)).toBe(200);
  });

  it('keeps fixed routes in place and moves only the movable one', () => {
    const fixed: TrackRoute = {
      pts: route([0, 0], [200, 0], [200, 100], [400, 100]),
      movable: false,
    };
    const mv: TrackRoute = { pts: route([0, 40], [200, 40], [200, 160], [400, 160]), movable: true };
    assignTracks([fixed, mv]);
    expect(vx(fixed.pts)).toBe(200);
    expect(Math.abs(vx(mv.pts) - 200)).toBeGreaterThanOrEqual(MIN_SEP);
  });

  it('never moves port legs (2-point straight routes have no interior segment)', () => {
    const a: TrackRoute = { pts: route([200, 0], [200, 100]), movable: true };
    const b: TrackRoute = { pts: route([200, 40], [200, 160]), movable: true };
    assignTracks([a, b]);
    expect(a.pts[0].x).toBe(200);
    expect(b.pts[0].x).toBe(200);
  });

  it('skips a lane that would cross a card and takes the other side', () => {
    // A card sits just right of the shared vertical, covering the vertical's
    // span but NOT the exit legs' rows — +TRACK_GAP would cut through it, so
    // the movable route must go left instead.
    const card: Rect = { x1: 202, y1: 50, x2: 260, y2: 90 };
    const fixed: TrackRoute = {
      pts: route([0, 0], [200, 0], [200, 100], [400, 100]),
      movable: false,
    };
    const mv: TrackRoute = {
      pts: route([0, 40], [200, 40], [200, 160], [400, 160]),
      movable: true,
      obstacles: [card],
    };
    assignTracks([fixed, mv]);
    expect(vx(mv.pts)).toBeLessThan(200);
  });

  it('falls back to the original position when every lane is blocked', () => {
    // Cards on both sides box the vertical in — better to overlap than cross.
    const walls: Rect[] = [
      { x1: 202, y1: -50, x2: 400 - 2, y2: 200 },
      { x1: 2, y1: -50, x2: 198, y2: 200 },
    ];
    const fixed: TrackRoute = {
      pts: route([0, 0], [200, 0], [200, 100], [400, 100]),
      movable: false,
    };
    const mv: TrackRoute = {
      pts: route([0, 40], [200, 40], [200, 160], [400, 160]),
      movable: true,
      obstacles: walls,
    };
    assignTracks([fixed, mv]);
    expect(vx(mv.pts)).toBe(200);
  });

  it('separates coincident horizontal interior segments too', () => {
    // 5-point routes whose middle horizontal runs along y=100.
    const mk = (x0: number): Pt[] =>
      route([x0, 0], [x0 + 50, 0], [x0 + 50, 100], [x0 + 300, 100], [x0 + 300, 200]);
    const a: TrackRoute = { pts: mk(0), movable: true };
    const b: TrackRoute = { pts: mk(20), movable: true };
    assignTracks([a, b]);
    const hy = (pts: Pt[]) => pts[2].y;
    expect(Math.abs(hy(a.pts) - hy(b.pts))).toBeGreaterThanOrEqual(MIN_SEP);
  });

  it('spreads a three-edge bundle onto distinct lanes', () => {
    const mk = (y0: number, y1: number): TrackRoute => ({
      pts: route([0, y0], [200, y0], [200, y1], [400, y1]),
      movable: true,
    });
    const rs = [mk(0, 300), mk(20, 200), mk(40, 260)];
    assignTracks(rs);
    const xs = rs.map((r) => vx(r.pts)).sort((p, q) => p - q);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(MIN_SEP);
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(MIN_SEP);
    // All lanes stay within the expected pitch envelope.
    for (const x of xs) expect(Math.abs(x - 200)).toBeLessThanOrEqual(3 * TRACK_GAP);
  });
});
