export interface PositionedLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendingLayoutNode {
  id: string;
  width: number;
  height: number;
  neighborIds: string[];
}

export interface LayoutPoint {
  x: number;
  y: number;
}

const HORIZONTAL_GAP = 160;
const VERTICAL_GAP = 48;

/**
 * Place only newly-added cards while treating every existing card as pinned.
 *
 * The new cards occupy a dedicated column to the right of the current layout.
 * A card with a relation to an existing/just-placed card prefers that card's
 * vertical centre; collision resolution picks the nearest free slot. This
 * keeps related additions visually close without risking any movement of the
 * user's hand-tuned layout.
 */
export function placeIncrementalNodes(
  fixed: readonly PositionedLayoutNode[],
  pending: readonly PendingLayoutNode[],
): Record<string, LayoutPoint> {
  if (pending.length === 0) return {};

  const fixedIds = new Set(fixed.map((node) => node.id));
  const knownPositions = new Map<string, LayoutPoint>(
    fixed.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  const fixedRight = fixed.length ? Math.max(...fixed.map((node) => node.x + node.width / 2)) : 0;
  const fixedTop = fixed.length ? Math.min(...fixed.map((node) => node.y - node.height / 2)) : 0;
  const maxPendingWidth = Math.max(...pending.map((node) => node.width));
  const columnX = fixedRight + HORIZONTAL_GAP + maxPendingWidth / 2;

  // Nodes attached to the pinned graph are placed first. The stable id tie-
  // break makes repeated rebuilds deterministic even if cy iteration changes.
  const ordered = [...pending].sort((a, b) => {
    const aAnchors = a.neighborIds.filter((id) => fixedIds.has(id)).length;
    const bAnchors = b.neighborIds.filter((id) => fixedIds.has(id)).length;
    return bAnchors - aAnchors || a.id.localeCompare(b.id);
  });

  const placed: PositionedLayoutNode[] = [];
  const result: Record<string, LayoutPoint> = {};
  let unanchoredCursor = fixedTop;

  for (const node of ordered) {
    const anchorYs = node.neighborIds.flatMap((id) => {
      const position = knownPositions.get(id);
      return position ? [position.y] : [];
    });
    const preferredY = anchorYs.length ? median(anchorYs) : unanchoredCursor + node.height / 2;
    const y = nearestFreeY(preferredY, node.height, placed);
    const position = { x: columnX, y };
    result[node.id] = position;
    knownPositions.set(node.id, position);
    placed.push({ ...node, ...position });
    unanchoredCursor = Math.max(unanchoredCursor, y + node.height / 2 + VERTICAL_GAP);
  }

  return result;
}

function nearestFreeY(
  preferred: number,
  height: number,
  placed: readonly PositionedLayoutNode[],
): number {
  const intervals = placed
    .map((node) => {
      const clearance = (height + node.height) / 2 + VERTICAL_GAP;
      return { start: node.y - clearance, end: node.y + clearance };
    })
    .sort((a, b) => a.start - b.start);
  if (intervals.length === 0) return preferred;

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  const blocked = merged.find((interval) => preferred > interval.start && preferred < interval.end);
  if (!blocked) return preferred;
  return preferred - blocked.start <= blocked.end - preferred ? blocked.start : blocked.end;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
