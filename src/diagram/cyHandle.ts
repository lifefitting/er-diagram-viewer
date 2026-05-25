/**
 * Module-level handle for the cytoscape singleton.
 *
 * This file intentionally has **no static import of cytoscape**. It only
 * stores a typed-as-unknown reference that `DiagramCanvas` writes into on
 * mount. The point is to let consumers like `Toolbar` and `ExportMenu`
 * call into the diagram without static-importing `DiagramCanvas.tsx` —
 * which would otherwise pull cytoscape (≈250 KB) into the main chunk and
 * defeat the React.lazy split.
 *
 * Why `unknown` and a generic typed `getCy<T>()`:
 *   Importing the actual `Core` type from `cytoscape` would re-introduce
 *   the dependency edge we just avoided. Callers that need the type pass
 *   it explicitly via the generic parameter.
 */

let cyInstance: unknown = null;
let relayoutFn: (() => void) | null = null;

/** Set by DiagramCanvas on mount; cleared on unmount. */
export function bindCy(cy: unknown, relayout: () => void): void {
  cyInstance = cy;
  relayoutFn = relayout;
}

/** Called by DiagramCanvas on unmount to keep getCy() honest. */
export function unbindCy(): void {
  cyInstance = null;
  relayoutFn = null;
}

/**
 * Get the current cytoscape instance, or null if the canvas hasn't mounted
 * yet (initial paint, suspended chunk still loading, etc.). Callers should
 * tolerate `null` rather than asserting.
 */
export function getCy<T = unknown>(): T | null {
  return cyInstance as T | null;
}

/**
 * Trigger a fresh layout on the current graph. No-op while the canvas
 * isn't mounted — toolbar buttons stay clickable but harmless during the
 * brief Suspense window.
 */
export function relayoutCurrent(): void {
  relayoutFn?.();
}
