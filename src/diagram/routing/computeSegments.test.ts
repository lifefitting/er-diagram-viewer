import { describe, it, expect } from 'vitest';
import { computeSegments } from './computeSegments';

/**
 * The contract of computeSegments is: given source (sx, sy) and target
 * (tx, ty), the two bend points it returns must reconstruct to
 *   bend1 = (mx, sy)   where mx = (sx + tx) / 2
 *   bend2 = (mx, ty)
 * Cytoscape evaluates each bend as
 *   bend = source + w·(t-s) + d·perp
 * where perp is the unit normal of (t-s) rotated 90° CCW: perp = (-dy, dx)/L.
 */
function reconstructBend(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  w: number,
  d: number,
): { x: number; y: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  const L = Math.hypot(dx, dy);
  if (L === 0) return { x: sx, y: sy };
  const px = -dy / L;
  const py = dx / L;
  return { x: sx + w * dx + d * px, y: sy + w * dy + d * py };
}

function parsePair(s: string): [number, number] {
  const parts = s.split(/\s+/).map(Number);
  return [parts[0], parts[1]];
}

describe('computeSegments', () => {
  it('lands bends at (mx, sy) and (mx, ty) for diagonal edges', () => {
    const sx = 0,
      sy = 0,
      tx = 100,
      ty = 60;
    const { weights, distances } = computeSegments(sx, sy, tx, ty);
    const [w1, w2] = parsePair(weights);
    const [d1, d2] = parsePair(distances);
    const b1 = reconstructBend(sx, sy, tx, ty, w1, d1);
    const b2 = reconstructBend(sx, sy, tx, ty, w2, d2);
    const mx = (sx + tx) / 2;
    expect(b1.x).toBeCloseTo(mx, 1);
    expect(b1.y).toBeCloseTo(sy, 1);
    expect(b2.x).toBeCloseTo(mx, 1);
    expect(b2.y).toBeCloseTo(ty, 1);
  });

  it('handles right-to-left edges (negative dx)', () => {
    const sx = 200,
      sy = 50,
      tx = 0,
      ty = 150;
    const { weights, distances } = computeSegments(sx, sy, tx, ty);
    const [w1, w2] = parsePair(weights);
    const [d1, d2] = parsePair(distances);
    const b1 = reconstructBend(sx, sy, tx, ty, w1, d1);
    const b2 = reconstructBend(sx, sy, tx, ty, w2, d2);
    const mx = (sx + tx) / 2;
    expect(b1.x).toBeCloseTo(mx, 1);
    expect(b1.y).toBeCloseTo(sy, 1);
    expect(b2.x).toBeCloseTo(mx, 1);
    expect(b2.y).toBeCloseTo(ty, 1);
  });

  it('degenerates to straight line when src == tgt', () => {
    expect(computeSegments(50, 50, 50, 50)).toEqual({ weights: '0.5', distances: '0' });
  });

  it('handles purely horizontal edges', () => {
    const { weights, distances } = computeSegments(0, 0, 100, 0);
    const [w1, w2] = parsePair(weights);
    const [d1, d2] = parsePair(distances);
    // Both bends should land on the y=0 line at the midpoint (no vertical
    // offset needed for a horizontal edge).
    const b1 = reconstructBend(0, 0, 100, 0, w1, d1);
    const b2 = reconstructBend(0, 0, 100, 0, w2, d2);
    expect(b1.y).toBeCloseTo(0, 1);
    expect(b2.y).toBeCloseTo(0, 1);
  });
});
