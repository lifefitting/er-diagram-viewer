import type { Pt, Rect } from './channelRoute';

export function nodeInfluenceRect(center: Pt, width: number, height: number, padding = 40): Rect {
  return {
    x1: center.x - width / 2 - padding,
    y1: center.y - height / 2 - padding,
    x2: center.x + width / 2 + padding,
    y2: center.y + height / 2 + padding,
  };
}

/** Conservative broad phase: false means the route definitely cannot have
 * been blocked/unblocked by a moved card; true is refined by re-routing. */
export function routeMayBeAffected(points: readonly Pt[], areas: readonly Rect[]): boolean {
  if (points.length === 0 || areas.length === 0) return false;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const point of points) {
    x1 = Math.min(x1, point.x);
    y1 = Math.min(y1, point.y);
    x2 = Math.max(x2, point.x);
    y2 = Math.max(y2, point.y);
  }
  return areas.some((area) => x1 <= area.x2 && x2 >= area.x1 && y1 <= area.y2 && y2 >= area.y1);
}
