export type SelectionArrangement =
  | 'align-left'
  | 'align-horizontal-center'
  | 'align-right'
  | 'align-top'
  | 'align-vertical-center'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical';

export interface ArrangeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ArrangedPositions = Record<string, { x: number; y: number }>;

/**
 * Compute aligned/distributed center positions without mutating Cytoscape.
 * Alignment uses the outer bounds of the complete selection. Distribution
 * keeps the two outer objects fixed and makes the visible gaps equal, which
 * remains intuitive when selected tables have different widths/heights.
 */
export function arrangeSelection(
  boxes: readonly ArrangeBox[],
  operation: SelectionArrangement,
): ArrangedPositions {
  const positions = Object.fromEntries(
    boxes.map((box) => [box.id, { x: box.x, y: box.y }]),
  ) as ArrangedPositions;
  if (boxes.length < 2) return positions;

  const left = Math.min(...boxes.map((box) => box.x - box.width / 2));
  const right = Math.max(...boxes.map((box) => box.x + box.width / 2));
  const top = Math.min(...boxes.map((box) => box.y - box.height / 2));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height / 2));

  switch (operation) {
    case 'align-left':
      for (const box of boxes) positions[box.id].x = left + box.width / 2;
      break;
    case 'align-horizontal-center': {
      const center = (left + right) / 2;
      for (const box of boxes) positions[box.id].x = center;
      break;
    }
    case 'align-right':
      for (const box of boxes) positions[box.id].x = right - box.width / 2;
      break;
    case 'align-top':
      for (const box of boxes) positions[box.id].y = top + box.height / 2;
      break;
    case 'align-vertical-center': {
      const center = (top + bottom) / 2;
      for (const box of boxes) positions[box.id].y = center;
      break;
    }
    case 'align-bottom':
      for (const box of boxes) positions[box.id].y = bottom - box.height / 2;
      break;
    case 'distribute-horizontal':
      distribute(boxes, positions, 'x');
      break;
    case 'distribute-vertical':
      distribute(boxes, positions, 'y');
      break;
  }

  return positions;
}

function distribute(
  boxes: readonly ArrangeBox[],
  positions: ArrangedPositions,
  axis: 'x' | 'y',
): void {
  if (boxes.length < 3) return;
  const size = (box: ArrangeBox) => (axis === 'x' ? box.width : box.height);
  const sorted = [...boxes].sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const outerStart = first[axis] - size(first) / 2;
  const outerEnd = last[axis] + size(last) / 2;
  const occupied = sorted.reduce((sum, box) => sum + size(box), 0);
  const gap = (outerEnd - outerStart - occupied) / (sorted.length - 1);
  let cursor = outerStart;

  for (const box of sorted) {
    positions[box.id][axis] = cursor + size(box) / 2;
    cursor += size(box) + gap;
  }
}
