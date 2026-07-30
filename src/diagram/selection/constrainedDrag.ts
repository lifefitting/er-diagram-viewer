export interface DragDelta {
  dx: number;
  dy: number;
  axis: 'free' | 'horizontal' | 'vertical';
}

/** Shift deliberately moves at quarter speed: one screen pixel becomes 0.25
 * model pixel before zoom correction, making field-port alignment controllable
 * without requiring a high-DPI mouse. Alt wins if both modifiers are held. */
export function constrainDragDelta(
  screenDx: number,
  screenDy: number,
  zoom: number,
  modifiers: { altKey: boolean; shiftKey: boolean },
): DragDelta {
  const safeZoom = zoom > 0 ? zoom : 1;
  if (modifiers.altKey) {
    return { dx: screenDx / safeZoom, dy: 0, axis: 'horizontal' };
  }
  if (modifiers.shiftKey) {
    return { dx: 0, dy: screenDy / safeZoom / 4, axis: 'vertical' };
  }
  return { dx: screenDx / safeZoom, dy: screenDy / safeZoom, axis: 'free' };
}

/** Snap a vertical group delta to the closest connected-port alignment target.
 * `threshold` is expressed in model pixels (callers convert from screen px). */
export function snapVerticalDelta(
  dy: number,
  targets: readonly number[],
  threshold: number,
): { dy: number; snapped: boolean } {
  let closest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const nextDistance = Math.abs(target - dy);
    if (nextDistance < distance) {
      closest = target;
      distance = nextDistance;
    }
  }
  return closest !== null && distance <= threshold
    ? { dy: closest, snapped: true }
    : { dy, snapped: false };
}
