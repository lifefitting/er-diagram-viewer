import type { ForeignKey, Schema } from '../parser/types';
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
  /** Draw the inferred logical (business-key) links on the canvas. The 逻辑
   *  关联 section's 隐藏/显示连线 toggle — hide them all to compare the
   *  physical-only picture, flip back to see the full one. */
  showLogicalLinks: boolean;
  /** Draw the hand-drawn manual relations (手动连线 section's toggle). */
  showManualLinks: boolean;
}

export interface SchemaState {
  rawSql: string;
  schema: Schema | null;
  inferred: InferredFK[];
  modules: ModulesResult;
  palette: PaletteName;
  /** Business-key column names (lowercased) the user picked in the 逻辑关联
   *  scan — logical-link inference runs ONLY for these. Persisted (a refresh
   *  re-derives the same candidates); cleared on a new import (`setSql`). */
  logicalKeys: string[];
  /** Explicit table → module assignments made from the canvas multi-select
   *  toolbar. Keys are stable cy node ids; values are inferred module keys.
   *  The automatic inference remains the baseline and these persisted choices
   *  are applied last, so a user decision always wins without rewriting DDL. */
  moduleOverrides: Record<string, string>;
  /** Source workspaces retained by a multi-archive import. Each group owns the
   *  tables and logical-key scope from one archive, plus a camera bookmark for
   *  quick navigation. Empty for a normal SQL/single-archive workspace. */
  workspaceGroups: WorkspaceGroup[];
  /** Bumped by `importWorkspace`; keys the DiagramCanvas so an archive import
   *  remounts it. A fresh mount is what re-arms the one-shot camera restore
   *  and discards stale in-session positions — i.e. the import replays the
   *  page-refresh restore path exactly. Transient (never persisted). */
  workspaceEpoch: number;
  setSql: (sql: string) => void;
  reparse: () => void;
  setPalette: (p: PaletteName) => void;
  /** Replace the picked business keys and re-derive inferred + modules. */
  setLogicalKeys: (keys: string[]) => void;
  /** Move all selected tables into an existing module. Passing null removes
   *  their explicit assignments and restores automatic grouping. */
  assignTablesToModule: (nodeIds: string[], moduleKey: string | null) => void;
  /** Replace the whole workspace with a validated `.erreview` archive payload
   *  (see exports/archive.ts). Caller must pre-flight `parseSql` on the
   *  payload's rawSql — this action assumes it parses. */
  importWorkspace: (state: Partial<AppState> & { rawSql: string }) => void;
}

export interface DecisionsState {
  decisions: Record<string, 'accept' | 'reject'>;
  /** User-added FKs (`source: 'manual'`) for relations the engine can't infer
   *  (e.g. `check_task_detail.task_id → check_task`). Always drawn solid, not
   *  gated by `decisions`. Persisted; cleared on a new import (`setSql`), kept
   *  on refresh (`reparse`) — same lifecycle as `decisions`. */
  manualFks: ForeignKey[];
  acceptFk: (key: string) => void;
  rejectFk: (key: string) => void;
  batchDecide: (keys: string[], decision: 'accept' | 'reject') => void;
  batchClear: (keys: string[]) => void;
  resetDecisions: () => void;
  /** Add a manual FK. No-op if its `canonicalFkKey` collides with any explicit,
   *  inferred, or existing manual FK — callers validate first for UX, this
   *  guard keeps the buildGraph route-key invariant safe. */
  addManualFk: (fk: ForeignKey) => void;
  /** Remove a manual FK by its `canonicalFkKey`. */
  removeManualFk: (key: string) => void;
  /** Flip a manual relation between 物理外键 and 逻辑关联 (the 手动连线 panel's
   *  batch type editing). Returns a user-facing error when the switch would
   *  collide with another relation's key (logical re-normalizes direction, so
   *  the key can change); null on success. */
  setManualFkKind: (key: string, kind: 'fk' | 'logical') => string | null;
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
  /** A deferred Enter-step direction: set when the user presses Enter while the
   *  query is still being flushed (the match list hasn't recomputed yet), and
   *  consumed by `setSearchMatches` once the fresh list lands. Transient. */
  pendingSearchStep: 1 | -1 | null;
  /** User-chosen theme preference. Resolution to a concrete light/dark mode
   *  happens in the App-level effect that toggles the `.dark` class. */
  theme: ThemePreference;
  setSearch: (s: string) => void;
  toggleDisplay: (k: keyof DisplayOptions) => void;
  setTheme: (t: ThemePreference) => void;
  /** Replace the ordered match list (canvas → store). Preserves the active
   *  cursor across a pure reorder, resets it when the match SET changed, and
   *  applies any `pendingSearchStep` (deferred Enter). */
  setSearchMatches: (ids: string[]) => void;
  /** Step the active match forward (+1) / backward (-1) with wraparound. */
  cycleSearchMatch: (dir: 1 | -1) => void;
  /** Defer an Enter-step until the next `setSearchMatches` (the query is being
   *  flushed and the match list hasn't recomputed yet). */
  requestSearchStep: (dir: 1 | -1) => void;
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

/** Persisted provenance + navigation metadata for one member of a merged
 *  workspace. `translation` is the one rigid model-space offset applied to
 *  every saved node and route point from the source archive. */
export interface WorkspaceGroup {
  id: string;
  label: string;
  sourceFile: string;
  nodeIds: string[];
  logicalKeys: string[];
  palette: PaletteName;
  viewport: Viewport | null;
  translation: { x: number; y: number };
}

/** A table-level review decision. Marking a table for deletion also hides it
 *  from the working canvas, but this metadata makes the action an auditable
 *  review record instead of an anonymous recycle-bin flag. */
export interface TableDeleteDecision {
  action: 'delete';
  /** ISO timestamp for when the reviewer marked the table. Empty only for
   *  legacy snapshots that stored `true` without an operation time. */
  updatedAt: string;
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
  /** Tables marked 建议删除, keyed by cy node id (`t:`+lowercase). The mark is
   *  an auditable review decision (action + time) and also hides the card from
   *  the canvas; the SQL is never touched. Same lifecycle as `nodePositions`. */
  deletedTables: Record<string, TableDeleteDecision>;
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
  /** Center + flash a single table (e.g. clicking a review note in the
   *  recent-notes overlay). */
  flashTable: (tableName: string) => void;
  clearFlash: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCanvasMode: (m: CanvasMode) => void;
  toggleCanvasMode: () => void;
}

/** Review-note severity（级别）: how serious the finding is. */
export type NoteSeverity = 'suggest' | 'warn' | 'block';
/** Review-note status（状态）: where the finding sits in the review loop. */
export type NoteStatus = 'open' | 'accepted' | 'rejected';

/** One field-level review annotation. */
export interface FieldNote {
  text: string;
  /** ISO timestamp of the last content edit — part of the review record
   *  (exported in the 评审报告 and shown in the recent-notes overlay). Empty
   *  for legacy notes persisted before timestamps existed. Status-only flips
   *  do NOT touch it — it reads as 写于 (written at). */
  updatedAt: string;
  /** 建议 (suggest) | 警告 (warn) | 阻塞 (block). Legacy notes upgrade to
   *  'suggest' on load. */
  severity: NoteSeverity;
  /** 待处理 (open) | 已采纳 (accepted) | 不采纳 (rejected). Multi-round
   *  reviews flow notes through these; legacy notes upgrade to 'open'. */
  status: NoteStatus;
}

export interface NotesState {
  /** Field-level review annotations, keyed `table::column` (see
   *  `fieldNoteKey`). Persisted; cleared on a new import (`setSql`); surfaced
   *  in the 评审报告 export. */
  fieldNotes: Record<string, FieldNote>;
  /** Set (or clear, with empty text) the review note for one field. Absent
   *  meta fields keep the note's current values (or the defaults 建议/待处理
   *  for a new note). */
  setFieldNote: (
    table: string,
    column: string,
    text: string,
    meta?: { severity?: NoteSeverity; status?: NoteStatus },
  ) => void;
  /** Flip only the status（状态流转）— keeps text, severity AND `updatedAt`
   *  (the 写于 timestamp records authorship, not triage). */
  setFieldNoteStatus: (table: string, column: string, status: NoteStatus) => void;
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

export type AppState = SchemaState &
  DecisionsState &
  DisplayState &
  CanvasState &
  HistoryState &
  NotesState;
