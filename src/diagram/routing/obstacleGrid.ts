import type { Rect } from './channelRoute';

export interface ObstacleGrid {
  cellSize: number;
  cells: Map<string, Set<string>>;
  rectById: ReadonlyMap<string, Rect>;
}

export function buildObstacleGrid(
  rectById: ReadonlyMap<string, Rect>,
  cellSize = 320,
): ObstacleGrid {
  const cells = new Map<string, Set<string>>();
  for (const [id, rect] of rectById) {
    const minX = Math.floor(rect.x1 / cellSize);
    const maxX = Math.floor(rect.x2 / cellSize);
    const minY = Math.floor(rect.y1 / cellSize);
    const maxY = Math.floor(rect.y2 / cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = new Set();
          cells.set(key, bucket);
        }
        bucket.add(id);
      }
    }
  }
  return { cellSize, cells, rectById };
}

/** Nearby obstacles for the interactive preview pass. The final pass still
 * considers every card and therefore remains publication/export quality. */
export function queryObstacleGrid(
  grid: ObstacleGrid,
  bounds: Rect,
  excludedIds: ReadonlySet<string>,
): Rect[] {
  const ids = new Set<string>();
  const minX = Math.floor(bounds.x1 / grid.cellSize);
  const maxX = Math.floor(bounds.x2 / grid.cellSize);
  const minY = Math.floor(bounds.y1 / grid.cellSize);
  const maxY = Math.floor(bounds.y2 / grid.cellSize);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (const id of grid.cells.get(`${x}:${y}`) ?? []) {
        if (!excludedIds.has(id)) ids.add(id);
      }
    }
  }
  return [...ids].flatMap((id) => {
    const rect = grid.rectById.get(id);
    return rect ? [rect] : [];
  });
}
