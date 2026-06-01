/**
 * Module-level handle for the cytoscape singleton + the imperative view and
 * undo/redo machinery that the toolbar / canvas controls reach into.
 *
 * This file intentionally has **no static import of cytoscape**. It only stores
 * a typed-as-unknown reference (inside the bound `view`) plus session-only
 * snapshot stacks. The point is to let consumers like `CanvasControls`,
 * `Toolbar` and `ExportMenu` drive the diagram without static-importing
 * `DiagramCanvas.tsx` — which would otherwise pull cytoscape (≈250 KB) into the
 * main chunk and defeat the React.lazy split.
 *
 * `DiagramCanvas` binds the live view + history apply-fn on mount and tears
 * them down on unmount, so the bind/unbind lifecycle is strictly tied to the
 * canvas mount and nothing here can drift to a stale cy instance.
 */

/** A snapshot of the user-editable layout — card positions, width overrides and
 *  hand-edited connector routes (keyed by canonicalFkKey). */
export interface LayoutSnapshot {
  positions: Record<string, { x: number; y: number }>;
  widths: Record<string, number>;
  routes: Record<string, { x: number; y: number }[]>;
}

/** The imperative view API bound by DiagramCanvas. `cy` is typed-as-unknown so
 *  no cytoscape type leaks into this module; callers cast via `getCy<Core>()`. */
export interface CyView {
  cy: unknown;
  relayout: () => void;
  fit: () => void;
  resetZoom: () => void;
  zoomToSelection: () => void;
  /** Pan (keeping zoom) so the given node id is centered — used by search
   *  match navigation to follow the active hit. No-op if the node is gone. */
  centerOnNode: (id: string) => void;
  getZoom: () => number;
  /** Subscribe to cy zoom changes; returns an unsubscribe fn. */
  onZoomChange: (cb: () => void) => () => void;
}

let view: CyView | null = null;

// ---- Undo/redo snapshot machinery (session-only; never persisted) ----------
let undoStack: LayoutSnapshot[] = [];
let redoStack: LayoutSnapshot[] = [];
let lastSnapshot: LayoutSnapshot | null = null;
let applyFn: ((s: LayoutSnapshot) => void) | null = null;
let setFlags: ((canUndo: boolean, canRedo: boolean) => void) | null = null;
let isApplying = false;
/** Bound on the history depth so a very large schema with hundreds of drags
 *  can't grow the stacks without limit. */
const HISTORY_CAP = 50;

function syncFlags(): void {
  setFlags?.(undoStack.length > 0, redoStack.length > 0);
}

/** Set by DiagramCanvas on mount. */
export function bindView(v: CyView): void {
  view = v;
}

/** Called by DiagramCanvas on unmount — also clears history (the snapshots
 *  reference cy nodes that are about to be destroyed). */
export function unbindView(): void {
  view = null;
  resetHistory();
  unbindHistory();
}

export function getView(): CyView | null {
  return view;
}

/**
 * Get the current cytoscape instance, or null if the canvas hasn't mounted yet
 * (initial paint, suspended chunk still loading, etc.). Callers should tolerate
 * `null` rather than asserting. Kept as a thin shim over `view` so existing
 * callers (ExportMenu's `cy.png`, CanvasControls' zoom helpers) are unchanged.
 */
export function getCy<T = unknown>(): T | null {
  return (view?.cy ?? null) as T | null;
}

/** Trigger a fresh layout on the current graph. No-op while the canvas isn't
 *  mounted — toolbar buttons stay clickable but harmless during Suspense. */
export function relayoutCurrent(): void {
  view?.relayout();
}

/** Bind the apply-fn (writes a snapshot back into cy) + the flags callback
 *  (pushes canUndo/canRedo into the store). Set by DiagramCanvas on mount. */
export function bindHistory(
  apply: (s: LayoutSnapshot) => void,
  flags: (canUndo: boolean, canRedo: boolean) => void,
): void {
  applyFn = apply;
  setFlags = flags;
}

export function unbindHistory(): void {
  applyFn = null;
  setFlags = null;
}

/** Establish the baseline state (after a layout) without creating an undo step. */
export function seedHistory(s: LayoutSnapshot): void {
  lastSnapshot = s;
}

/** Hard reset — a relayout/rebuild can't be undone past, and old snapshots may
 *  reference nodes that no longer exist. */
export function resetHistory(): void {
  undoStack = [];
  redoStack = [];
  lastSnapshot = null;
  syncFlags();
}

/** Record a new layout state (after a drag/resize). The previous state becomes
 *  undoable and any redo branch is discarded. */
export function pushHistory(s: LayoutSnapshot): void {
  if (lastSnapshot) {
    undoStack.push(lastSnapshot);
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
  }
  redoStack = [];
  lastSnapshot = s;
  syncFlags();
}

export function undo(): void {
  if (undoStack.length === 0 || !applyFn) return;
  if (lastSnapshot) redoStack.push(lastSnapshot);
  lastSnapshot = undoStack.pop() ?? null;
  if (!lastSnapshot) return;
  isApplying = true;
  try {
    applyFn(lastSnapshot);
  } finally {
    isApplying = false;
  }
  syncFlags();
}

export function redo(): void {
  if (redoStack.length === 0 || !applyFn) return;
  if (lastSnapshot) undoStack.push(lastSnapshot);
  lastSnapshot = redoStack.pop() ?? null;
  if (!lastSnapshot) return;
  isApplying = true;
  try {
    applyFn(lastSnapshot);
  } finally {
    isApplying = false;
  }
  syncFlags();
}

/** True while a snapshot is being applied — capture points check this so an
 *  apply doesn't push a new (duplicate) history entry. */
export function getIsApplying(): boolean {
  return isApplying;
}
