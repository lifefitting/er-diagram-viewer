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
