import type { Pt } from './channelRoute';

/**
 * Layout-quality metrics over a set of orthogonal routes (`routePoints`
 * polylines). Pure functions — used by the regression tests as the quality
 * guardrail for any routing change, and by a DEV-only debug log in
 * `updateEdgeEndpoints` so a live session can report its own numbers.
 *
 * Only pairs of segments from DIFFERENT routes are compared: consecutive
 * segments of one route always share a bend point, and a route crossing
 * itself is a routing bug the routers already avoid, not a metric target.
 */

const TOL = 1;

interface Seg {
  a: Pt;
  b: Pt;
  route: number;
}

function collectSegments(routes: Pt[][]): { horizontal: Seg[]; vertical: Seg[] } {
  const horizontal: Seg[] = [];
  const vertical: Seg[] = [];
  routes.forEach((pts, route) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a.y - b.y) <= TOL && Math.abs(a.x - b.x) > TOL) {
        horizontal.push({ a, b, route });
      } else if (Math.abs(a.x - b.x) <= TOL && Math.abs(a.y - b.y) > TOL) {
        vertical.push({ a, b, route });
      }
      // Diagonal segments (shouldn't exist post-orthogonalize) are ignored.
    }
  });
  return { horizontal, vertical };
}

/**
 * Count proper H×V crossings between segments of different routes. Touching
 * endpoints (a T-junction where one segment ends ON the other) are not counted
 * — visually they read as a join, not a crossing.
 */
export function countCrossings(routes: Pt[][]): number {
  const { horizontal, vertical } = collectSegments(routes);
  let count = 0;
  for (const h of horizontal) {
    const hy = (h.a.y + h.b.y) / 2;
    const hx1 = Math.min(h.a.x, h.b.x);
    const hx2 = Math.max(h.a.x, h.b.x);
    for (const v of vertical) {
      if (v.route === h.route) continue;
      const vx = (v.a.x + v.b.x) / 2;
      const vy1 = Math.min(v.a.y, v.b.y);
      const vy2 = Math.max(v.a.y, v.b.y);
      if (vx > hx1 + TOL && vx < hx2 - TOL && hy > vy1 + TOL && hy < vy2 - TOL) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Count pairs of same-orientation segments from different routes that are
 * collinear (within TOL) and overlap for more than TOL along their axis —
 * i.e. lines the user sees as ONE line hiding several edges. The direct
 * target of the gutter track-assignment pass.
 */
export function countOverlaps(routes: Pt[][]): number {
  const { horizontal, vertical } = collectSegments(routes);
  let count = 0;
  const overlap1d = (a1: number, a2: number, b1: number, b2: number): number =>
    Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
  for (let i = 0; i < horizontal.length; i++) {
    for (let j = i + 1; j < horizontal.length; j++) {
      const p = horizontal[i];
      const q = horizontal[j];
      if (p.route === q.route) continue;
      if (Math.abs(p.a.y - q.a.y) > TOL) continue;
      if (overlap1d(p.a.x, p.b.x, q.a.x, q.b.x) > TOL) count++;
    }
  }
  for (let i = 0; i < vertical.length; i++) {
    for (let j = i + 1; j < vertical.length; j++) {
      const p = vertical[i];
      const q = vertical[j];
      if (p.route === q.route) continue;
      if (Math.abs(p.a.x - q.a.x) > TOL) continue;
      if (overlap1d(p.a.y, p.b.y, q.a.y, q.b.y) > TOL) count++;
    }
  }
  return count;
}
