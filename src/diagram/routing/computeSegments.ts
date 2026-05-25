/**
 * Cytoscape's `segments` curve-style positions each bend point as
 *   bend = source + w · (target - source) + d · perp
 * where `perp` is the unit vector perpendicular to (target - source).
 *
 * We want a pure H-V-H polyline with bends at (mx, sy) and (mx, ty), where
 * `mx = (sx + tx) / 2`. Solving for the (w, d) pair that lands each bend on
 * the desired (x, y) yields the closed-form below.
 *
 * Bend 1 = (mx, sy):  w1 = dx² / (2·L²),         d1 = -dx·dy / (2·L)
 * Bend 2 = (mx, ty):  w2 = (dx² + 2·dy²)/(2·L²), d2 =  dx·dy / (2·L)
 *
 * When dx = 0 (purely vertical) both bends collapse onto the source/target
 * and we get a straight vertical line. When dy = 0 (purely horizontal) both
 * bends sit at the midpoint with zero perpendicular distance, also a
 * straight line. Both degenerate cases are handled naturally.
 *
 * Returns the two `segment-weights` / `segment-distances` strings cytoscape
 * expects, e.g. `"0.25 0.75"` and `"-35.4 35.4"`. Falls back to a degenerate
 * straight-line ("0.5"/"0") when src and tgt coincide.
 */
export function computeSegments(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): { weights: string; distances: string } {
  const dx = tx - sx;
  const dy = ty - sy;
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) {
    return { weights: '0.5', distances: '0' };
  }
  const L = Math.sqrt(L2);
  const w1 = (dx * dx) / (2 * L2);
  const d1 = (-dx * dy) / (2 * L);
  const w2 = (dx * dx + 2 * dy * dy) / (2 * L2);
  const d2 = (dx * dy) / (2 * L);
  return {
    weights: `${w1.toFixed(4)} ${w2.toFixed(4)}`,
    distances: `${d1.toFixed(2)} ${d2.toFixed(2)}`,
  };
}
