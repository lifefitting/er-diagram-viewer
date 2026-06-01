/** Keep at least this many px of the diagram within the viewport when panning. */
export const PAN_MARGIN = 120;

/**
 * Pure single-axis pan clamp. Given the content's model-space span `[c1, c2]` on
 * one axis, the viewport `size` (px) on that axis, and the zoom `z`, return the
 * pan that keeps at least `margin` px of the content in view — clamped into
 * `[margin - c2·z, size - margin - c1·z]`. When the content is small enough that
 * that interval is empty (`min > max`), the desired pan is returned unchanged
 * (no clamp is possible without pushing content off the other side).
 *
 * Extracted from the canvas so the math is unit-testable; `clampPan` in
 * DiagramCanvas just feeds it cy's bounding box / zoom / dimensions.
 */
export function clampPanAxis(
  p: number,
  c1: number,
  c2: number,
  size: number,
  z: number,
  margin = PAN_MARGIN,
): number {
  const min = margin - c2 * z;
  const max = size - margin - c1 * z;
  return min > max ? p : Math.max(min, Math.min(max, p));
}
