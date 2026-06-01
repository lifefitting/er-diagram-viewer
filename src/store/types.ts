import type { Schema } from '../parser/types';
import type { InferredFK } from '../infer/inferForeignKeys';
import type { ModulesResult, PaletteName } from '../infer/inferModules';

/** User-selectable theme preference. `system` follows the OS via
 *  `prefers-color-scheme`. Resolved to a concrete light/dark value by the
 *  effect that toggles the `dark` class on `<html>`. */
export type ThemePreference = 'light' | 'dark' | 'system';

export interface DisplayOptions {
  onlyPk: boolean;
  showType: boolean;
  showComment: boolean;
  showIndex: boolean;
  showLowConfidence: boolean;
}

export interface SchemaState {
  rawSql: string;
  schema: Schema | null;
  inferred: InferredFK[];
  modules: ModulesResult;
  palette: PaletteName;
  setSql: (sql: string) => void;
  reparse: () => void;
  setPalette: (p: PaletteName) => void;
}

export interface DecisionsState {
  decisions: Record<string, 'accept' | 'reject'>;
  acceptFk: (key: string) => void;
  rejectFk: (key: string) => void;
  batchDecide: (keys: string[], decision: 'accept' | 'reject') => void;
  batchClear: (keys: string[]) => void;
  resetDecisions: () => void;
}

export interface DisplayState {
  display: DisplayOptions;
  search: string;
  /** Ordered cy node ids of the current search matches, in on-canvas reading
   *  order. Set by the canvas (which knows node positions); read by the toolbar
   *  for the "n / m" counter and by the canvas to center the active one.
   *  Transient — never persisted. */
  searchMatchIds: string[];
  /** Index into `searchMatchIds` of the match the canvas is centered on, or -1
   *  before the user has stepped into the results (Enter / the nav buttons).
   *  Transient. */
  searchActiveIndex: number;
  /** User-chosen theme preference. Resolution to a concrete light/dark mode
   *  happens in the App-level effect that toggles the `.dark` class. */
  theme: ThemePreference;
  setSearch: (s: string) => void;
  toggleDisplay: (k: keyof DisplayOptions) => void;
  setTheme: (t: ThemePreference) => void;
  /** Replace the ordered match list (canvas → store); resets the active cursor
   *  when the set of matches actually changed. */
  setSearchMatches: (ids: string[]) => void;
  /** Step the active match forward (+1) / backward (-1) with wraparound. */
  cycleSearchMatch: (dir: 1 | -1) => void;
}

/** Canvas pointer mode: `select` = left-drag marquees; `pan` = left-drag pans
 *  (the hand tool). Space-drag and middle-drag pan in either mode. */
export type CanvasMode = 'select' | 'pan';

/** Persisted cytoscape camera (`cy.pan()` + `cy.zoom()`). */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasState {
  sidebarCollapsed: boolean;
  collapsed: Record<string, boolean>;
  tableWidths: Record<string, number>;
  /** Persisted card positions (keyed by cy node id) so a page refresh restores
   *  the current arrangement instead of re-running the auto-layout. Cleared on
   *  a new import (`setSql`); kept on refresh (`reparse`). Reset to the
   *  auto-layout only via the 重置布局 button. */
  nodePositions: Record<string, { x: number; y: number }>;
  /** User-edited connector polylines, keyed by `canonicalFkKey` (stable across
   *  rebuilds, unlike the cy edge id). Absolute model-space points incl. both
   *  ports; `updateEdgeEndpoints` re-docks the interior bends onto the live
   *  ports. Same persistence lifecycle as `nodePositions`. */
  manualRoutes: Record<string, { x: number; y: number }[]>;
  /** Tables hidden via the recycle bin, keyed by cy node id (`t:`+lowercase).
   *  Filtered out of the diagram + exports by `visibleSchema`; the SQL is never
   *  touched. Same persistence lifecycle as `nodePositions`. */
  deletedTables: Record<string, true>;
  /** Persisted camera (cy.pan() + cy.zoom()) so a refresh restores the exact
   *  on-screen view, not just node positions. Same lifecycle as `nodePositions`:
   *  cleared on a new import (`setSql`), kept on refresh (`reparse`). `null`
   *  means "use the auto-fit" (fresh import / first load). */
  viewport: Viewport | null;
  flashTables: string[];
  flashTick: number;
  canvasMode: CanvasMode;
  toggleCollapsed: (tableName: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  setTableWidth: (tableName: string, width: number | null) => void;
  resetTableWidths: () => void;
  setNodePositions: (positions: Record<string, { x: number; y: number }>) => void;
  setViewport: (v: Viewport | null) => void;
  setManualRoute: (fkKey: string, points: { x: number; y: number }[]) => void;
  clearManualRoute: (fkKey: string) => void;
  /** Drop overrides for the given edge fkKeys (used when an endpoint node is
   *  moved/resized/deleted by the user — derived from the cy edges). */
  clearManualRoutesForNode: (fkKeys: string[]) => void;
  clearAllManualRoutes: () => void;
  replaceManualRoutes: (routes: Record<string, { x: number; y: number }[]>) => void;
  /** Drop override entries whose key is not in `liveKeys` (prune dead edges). */
  pruneManualRoutes: (liveKeys: string[]) => void;
  deleteTables: (ids: string[]) => void;
  restoreTable: (id: string) => void;
  restoreAllTables: () => void;
  flashModule: (moduleKey: string) => void;
  clearFlash: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCanvasMode: (m: CanvasMode) => void;
  toggleCanvasMode: () => void;
}

/**
 * Undo/redo enablement for layout changes. Only the two reactive booleans live
 * here so the toolbar buttons re-render/grey correctly; the actual snapshot
 * stacks + apply logic live in `diagram/cyHandle` (heavy, session-only, and
 * must stay out of the persisted store). The `undo`/`redo` actions delegate to
 * cyHandle, and cyHandle pushes enablement back via `setHistoryFlags`.
 */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  setHistoryFlags: (canUndo: boolean, canRedo: boolean) => void;
}

export type AppState = SchemaState & DecisionsState & DisplayState & CanvasState & HistoryState;
