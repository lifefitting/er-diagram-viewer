import { segIntersectsRect, type Pt, type Rect } from './channelRoute';

/**
 * Gutter track assignment — the global post-pass that separates routes the
 * per-edge routers laid on top of each other.
 *
 * Every edge is routed independently (`directOrthogonalRoute` always tries the
 * gutter midpoint first), so parallel edges through one gutter coincide into a
 * single visual line. This pass looks at ALL routes together: it clusters
 * near-coincident interior segments, and nudges movable ones onto separate
 * lanes so each edge reads as its own line.
 *
 * Contract:
 *   - Only INTERIOR segments move (both endpoints are bends). Port legs stay
 *     pinned to their field-row docks.
 *   - `movable: false` routes (manual overrides, self-loops, edges outside the
 *     current update batch) are never touched, but their segments still occupy
 *     lanes so movable ones dodge them.
 *   - A nudge that would cross a card (checked against the route's own
 *     obstacle set) falls back to the original position — an overlap is better
 *     than a crossing through a table.
 *   - Points are mutated in place; the caller re-encodes afterwards.
 */

export interface TrackRoute {
  pts: Pt[];
  movable: boolean;
  /** Card rects this route must not cross (its two endpoint cards excluded). */
  obstacles?: Rect[];
}

/** Segments closer than this (px) are considered the same gutter cluster. */
export const CLUSTER_TOL = 8;
/** Minimum separation between parallel segments after the pass. */
export const MIN_SEP = 6;
/** Lane pitch used when searching for a free position. */
export const TRACK_GAP = 9;
/** How many lanes to try on each side before giving up. */
const MAX_LANES = 3;

const EPS = 0.5;

interface SegRef {
  route: TrackRoute;
  /** Index of the segment's first point within `route.pts`. */
  i: number;
  /** Position along the packing axis (x for vertical segments). */
  pos: number;
  /** Extent along the segment axis, lo <= hi. */
  lo: number;
  hi: number;
  movable: boolean;
}

export function assignTracks(routes: TrackRoute[]): void {
  packAxis(routes, 'vertical');
  packAxis(routes, 'horizontal');
}

function packAxis(routes: TrackRoute[], axis: 'vertical' | 'horizontal'): void {
  const segs: SegRef[] = [];
  for (const route of routes) {
    const { pts } = route;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const isAxis =
        axis === 'vertical'
          ? Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS
          : Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS;
      if (!isAxis) continue;
      const interior = i >= 1 && i + 1 <= pts.length - 2;
      const pos = axis === 'vertical' ? a.x : a.y;
      const [s1, s2] = axis === 'vertical' ? [a.y, b.y] : [a.x, b.x];
      segs.push({
        route,
        i,
        pos,
        lo: Math.min(s1, s2),
        hi: Math.max(s1, s2),
        movable: route.movable && interior,
      });
    }
  }
  if (segs.length < 2) return;

  // Single-linkage clustering along the packing axis.
  segs.sort((p, q) => p.pos - q.pos);
  let clusterStart = 0;
  for (let k = 1; k <= segs.length; k++) {
    if (k === segs.length || segs[k].pos - segs[k - 1].pos > CLUSTER_TOL) {
      packCluster(segs.slice(clusterStart, k), axis);
      clusterStart = k;
    }
  }
}

function packCluster(cluster: SegRef[], axis: 'vertical' | 'horizontal'): void {
  if (cluster.length < 2) return;
  // Fixed segments claim their positions first; movable ones are placed in a
  // deterministic order (extent midpoint, then position). Each movable segment
  // then picks, among the overlap-free lanes, the one whose relocated legs
  // CROSS the fewest neighbouring routes — measuring beats guessing a sort
  // heuristic, because the crossing-optimal lane order depends on which side
  // each edge enters the gutter from and where it turns off.
  const placed: Array<{ pos: number; lo: number; hi: number }> = [];
  const movable: SegRef[] = [];
  for (const s of cluster) {
    if (s.movable) movable.push(s);
    else placed.push({ pos: s.pos, lo: s.lo, hi: s.hi });
  }
  movable.sort((p, q) => (p.lo + p.hi) / 2 - (q.lo + q.hi) / 2 || p.pos - q.pos);

  // Crossing evaluation context: every distinct route touching this cluster.
  const contextRoutes: Pt[][] = [];
  const seen = new Set<TrackRoute>();
  for (const s of cluster) {
    if (!seen.has(s.route)) {
      seen.add(s.route);
      contextRoutes.push(s.route.pts);
    }
  }

  for (const s of movable) {
    const conflicts = (pos: number): boolean =>
      placed.some((o) => Math.abs(o.pos - pos) < MIN_SEP && s.lo < o.hi - EPS && o.lo < s.hi - EPS);

    let chosen = s.pos;
    let bestScore = Infinity;
    for (let lane = 0; lane <= MAX_LANES; lane++) {
      for (const dir of lane === 0 ? [1] : [1, -1]) {
        const cand = s.pos + dir * lane * TRACK_GAP;
        if (conflicts(cand)) continue;
        if (lane > 0 && !clearsObstacles(s, cand, axis)) continue;
        // Prefer fewer crossings, then the smallest nudge from the original.
        const score = legCrossings(s, cand, axis, contextRoutes) * 1000 + lane;
        if (score < bestScore) {
          bestScore = score;
          chosen = cand;
        }
      }
      // A crossing-free lane can't be beaten by a farther one — stop early.
      if (bestScore < 1000) break;
    }
    if (chosen !== s.pos) applyMove(s, chosen, axis);
    placed.push({ pos: chosen, lo: s.lo, hi: s.hi });
  }
}

/**
 * Count proper crossings between segment `s` relocated to `pos` (its shifted
 * segment plus the two stretched neighbour legs) and every OTHER route in the
 * cluster's context, at their current positions. Greedy: earlier placements
 * are final, later movables are still at their pre-pass positions.
 */
function legCrossings(
  s: SegRef,
  pos: number,
  axis: 'vertical' | 'horizontal',
  contextRoutes: Pt[][],
): number {
  const pts = s.route.pts;
  const a = pts[s.i];
  const b = pts[s.i + 1];
  const na: Pt = axis === 'vertical' ? { x: pos, y: a.y } : { x: a.x, y: pos };
  const nb: Pt = axis === 'vertical' ? { x: pos, y: b.y } : { x: b.x, y: pos };
  const legs: Array<[Pt, Pt]> = [
    [pts[s.i - 1], na],
    [na, nb],
    [nb, pts[s.i + 2]],
  ];
  let count = 0;
  for (const other of contextRoutes) {
    if (other === pts) continue;
    for (let k = 0; k + 1 < other.length; k++) {
      for (const [p, q] of legs) {
        if (properCrossing(p, q, other[k], other[k + 1])) count++;
      }
    }
  }
  return count;
}

/** Proper H×V crossing (strictly interior on both segments). */
function properCrossing(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const aH = Math.abs(a1.y - a2.y) < EPS;
  const bH = Math.abs(b1.y - b2.y) < EPS;
  if (aH === bH) return false;
  const [h1, h2, v1, v2] = aH ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
  const hy = h1.y;
  const vx = v1.x;
  const hx1 = Math.min(h1.x, h2.x);
  const hx2 = Math.max(h1.x, h2.x);
  const vy1 = Math.min(v1.y, v2.y);
  const vy2 = Math.max(v1.y, v2.y);
  return vx > hx1 + EPS && vx < hx2 - EPS && hy > vy1 + EPS && hy < vy2 - EPS;
}

/**
 * Would moving segment `s` to `pos` keep its three affected legs (the shifted
 * segment plus the two stretched neighbours) clear of the route's obstacles?
 */
function clearsObstacles(s: SegRef, pos: number, axis: 'vertical' | 'horizontal'): boolean {
  const obstacles = s.route.obstacles ?? [];
  if (obstacles.length === 0) return true;
  const pts = s.route.pts;
  const a = pts[s.i];
  const b = pts[s.i + 1];
  const na: Pt = axis === 'vertical' ? { x: pos, y: a.y } : { x: a.x, y: pos };
  const nb: Pt = axis === 'vertical' ? { x: pos, y: b.y } : { x: b.x, y: pos };
  const legs: Array<[Pt, Pt]> = [
    [pts[s.i - 1], na],
    [na, nb],
    [nb, pts[s.i + 2]],
  ];
  return legs.every(([p, q]) => !obstacles.some((r) => segIntersectsRect(p, q, r)));
}

function applyMove(s: SegRef, pos: number, axis: 'vertical' | 'horizontal'): void {
  const pts = s.route.pts;
  if (axis === 'vertical') {
    pts[s.i].x = pos;
    pts[s.i + 1].x = pos;
  } else {
    pts[s.i].y = pos;
    pts[s.i + 1].y = pos;
  }
}
