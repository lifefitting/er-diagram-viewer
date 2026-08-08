export interface OverlayGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const applied = new WeakMap<HTMLElement, OverlayGeometry>();

/**
 * Apply the camera/drag hot path without asking React to reconcile a table's
 * complete field tree. Geometry is viewport-only runtime state: it is never
 * persisted and therefore cannot alter workspace archive compatibility.
 */
export function applyOverlayGeometry(element: HTMLElement, next: OverlayGeometry): boolean {
  const previous = applied.get(element);
  if (
    previous &&
    previous.x === next.x &&
    previous.y === next.y &&
    previous.w === next.w &&
    previous.h === next.h
  ) {
    return false;
  }
  element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
  element.style.width = `${next.w}px`;
  element.style.height = `${next.h}px`;
  applied.set(element, { ...next });
  return true;
}
