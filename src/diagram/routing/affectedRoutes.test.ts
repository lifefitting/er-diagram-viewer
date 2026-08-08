import { describe, expect, it } from 'vitest';
import { nodeInfluenceRect, routeMayBeAffected } from './affectedRoutes';

describe('affected route broad phase', () => {
  it('covers both the old and new card neighborhood conservatively', () => {
    const oldArea = nodeInfluenceRect({ x: 100, y: 100 }, 80, 60);
    const newArea = nodeInfluenceRect({ x: 500, y: 100 }, 80, 60);
    expect(
      routeMayBeAffected(
        [
          { x: 0, y: 100 },
          { x: 200, y: 100 },
        ],
        [oldArea, newArea],
      ),
    ).toBe(true);
    expect(
      routeMayBeAffected(
        [
          { x: 260, y: 400 },
          { x: 320, y: 400 },
        ],
        [oldArea, newArea],
      ),
    ).toBe(false);
  });
});
