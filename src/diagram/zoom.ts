/** Fixed ladder shared by every discrete zoom control. Wheel/pinch zoom remains
 * continuous; buttons and the canvas context menu snap to these stops. */
export const ZOOM_STOPS = [0.15, 0.2, 0.33, 0.5, 0.75, 1] as const;

/** Return the next ladder stop in the requested direction. Off-ladder values
 * snap outward; values at either boundary stay at that boundary. */
export function nextZoomStop(current: number, direction: 1 | -1): number {
  const epsilon = 0.001;
  if (direction > 0) {
    return ZOOM_STOPS.find((stop) => stop > current + epsilon) ?? ZOOM_STOPS.at(-1)!;
  }
  return [...ZOOM_STOPS].reverse().find((stop) => stop < current - epsilon) ?? ZOOM_STOPS[0];
}
