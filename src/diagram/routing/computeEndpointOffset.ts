import { HEADER_HEIGHT } from '../buildGraph';

/**
 * Compute the per-field endpoint offset (relative to a node's center) for one
 * side of an edge. `rowOffsetY` is the absolute Y position of the column row
 * center within the card (computed from `columnRowOffsets` by the caller),
 * or null when the table is collapsed / column is missing — in which case
 * the endpoint snaps to the card's vertical mid-header.
 *
 * `side` picks the left or right edge of the card; the caller decides based
 * on the relative x-position of the source vs. target node, so the edge
 * always exits the side closest to its peer instead of pointlessly looping
 * around.
 */
export function computeEndpointOffset(
  rowOffsetY: number | null,
  isCollapsed: boolean,
  boxWidth: number,
  boxHeight: number,
  side: 'left' | 'right',
): { x: number; y: number } {
  let y = 0;
  if (!isCollapsed && rowOffsetY != null) {
    y = rowOffsetY - boxHeight / 2;
  } else if (isCollapsed) {
    // Aim for header center so collapsed cards still have a sensible visual anchor.
    y = HEADER_HEIGHT / 2 - boxHeight / 2;
  }
  const x = side === 'right' ? boxWidth / 2 : -boxWidth / 2;
  return { x, y };
}
