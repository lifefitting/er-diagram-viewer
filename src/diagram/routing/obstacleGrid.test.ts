import { describe, expect, it } from 'vitest';
import { buildObstacleGrid, queryObstacleGrid } from './obstacleGrid';

describe('obstacle grid', () => {
  it('returns only nearby cards and excludes endpoint ids', () => {
    const grid = buildObstacleGrid(
      new Map([
        ['source', { x1: 0, y1: 0, x2: 100, y2: 80 }],
        ['near', { x1: 180, y1: 0, x2: 260, y2: 80 }],
        ['far', { x1: 1200, y1: 0, x2: 1280, y2: 80 }],
      ]),
      300,
    );
    expect(
      queryObstacleGrid(grid, { x1: -20, y1: -20, x2: 320, y2: 120 }, new Set(['source'])),
    ).toEqual([{ x1: 180, y1: 0, x2: 260, y2: 80 }]);
  });
});
