import type { NodePos } from '../types';

/** Axis-aligned rectangle in viewport (rendered) pixels — same space as `NodePos`. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Build a positive-width/height rect from the two corner points of a drag. The
 * pointer can travel in any direction (up-left, down-right, …), so we normalise
 * to a top-left origin with non-negative extents.
 */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/**
 * Axis-aligned overlap test. A shared edge (the marquee just grazing a card's
 * boundary) counts as an intersection — matching the "touch the box and it's
 * selected" behaviour users expect from a rubber-band.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/**
 * Node ids whose card rectangle intersects the marquee box. Touch = selected
 * (see `rectsIntersect`). `positions` carry viewport-space `x/y/w/h` already
 * synced from cytoscape, so no coordinate conversion is needed here.
 */
export function nodesInMarquee(positions: NodePos[], box: Rect): string[] {
  const ids: string[] = [];
  for (const p of positions) {
    if (rectsIntersect(box, { x: p.x, y: p.y, w: p.w, h: p.h })) ids.push(p.id);
  }
  return ids;
}

/**
 * Does an orthogonal polyline (an edge's route, in the SAME viewport space as
 * the box) touch the marquee rect? True when any vertex falls inside OR any
 * segment crosses the box — so a long straight connector swept by a thin
 * marquee still counts even though neither endpoint is inside. Used to include
 * hand-drawn relations in rubber-band selection.
 */
export function polylineIntersectsRect(pts: Array<{ x: number; y: number }>, box: Rect): boolean {
  const x2 = box.x + box.w;
  const y2 = box.y + box.h;
  const inside = (p: { x: number; y: number }) =>
    p.x >= box.x && p.x <= x2 && p.y >= box.y && p.y <= y2;
  for (const p of pts) if (inside(p)) return true;
  // Liang-Barsky segment/rect clip for each consecutive pair.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let ok = true;
    for (const [p, q] of [
      [-dx, a.x - box.x],
      [dx, x2 - a.x],
      [-dy, a.y - box.y],
      [dy, y2 - a.y],
    ] as Array<[number, number]>) {
      if (p === 0) {
        if (q < 0) {
          ok = false;
          break;
        }
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) {
          ok = false;
          break;
        }
        if (t > t0) t0 = t;
      } else {
        if (t < t0) {
          ok = false;
          break;
        }
        if (t < t1) t1 = t;
      }
    }
    if (ok && t0 <= t1) return true;
  }
  return false;
}
