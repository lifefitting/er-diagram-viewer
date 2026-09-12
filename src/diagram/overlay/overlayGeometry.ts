export interface OverlayGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const applied = new WeakMap<HTMLElement, { transform: string; w: number; h: number }>();

/** Align only the painted origin, never the model coordinates or dimensions.
 * A physical pixel is 1 CSS px at DPR 1 and 0.5 CSS px at DPR 2. Keep text in
 * the normal 2D paint path: a permanently promoted 3D layer can resample its
 * cached glyph bitmap when translated, visibly softening text on 1x screens. */
export function overlayTransform(
  x: number,
  y: number,
  pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio,
): string {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return `translate(${Math.round(x * ratio) / ratio}px, ${Math.round(y * ratio) / ratio}px)`;
}

/**
 * Apply the camera/drag hot path without asking React to reconcile a table's
 * complete field tree. Geometry is viewport-only runtime state: it is never
 * persisted and therefore cannot alter workspace archive compatibility.
 */
export function applyOverlayGeometry(
  element: HTMLElement,
  next: OverlayGeometry,
  pixelRatio?: number,
): boolean {
  const transform = overlayTransform(next.x, next.y, pixelRatio);
  const previous = applied.get(element);
  if (
    previous &&
    previous.transform === transform &&
    previous.w === next.w &&
    previous.h === next.h
  ) {
    return false;
  }
  if (previous?.transform !== transform) element.style.transform = transform;
  if (previous?.w !== next.w) element.style.width = `${next.w}px`;
  if (previous?.h !== next.h) element.style.height = `${next.h}px`;
  applied.set(element, { transform, w: next.w, h: next.h });
  return true;
}
