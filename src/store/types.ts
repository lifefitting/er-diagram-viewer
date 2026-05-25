import type { Schema } from '../parser/types';
import type { InferredFK } from '../infer/inferForeignKeys';
import type { ModulesResult, PaletteName } from '../infer/inferModules';

export type LayoutKind = 'fcose' | 'dagre';

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
  layout: LayoutKind;
  search: string;
  /** User-chosen theme preference. Resolution to a concrete light/dark mode
   *  happens in the App-level effect that toggles the `.dark` class. */
  theme: ThemePreference;
  setLayout: (l: LayoutKind) => void;
  setSearch: (s: string) => void;
  toggleDisplay: (k: keyof DisplayOptions) => void;
  setTheme: (t: ThemePreference) => void;
}

export interface CanvasState {
  sidebarCollapsed: boolean;
  collapsed: Record<string, boolean>;
  tableWidths: Record<string, number>;
  flashTables: string[];
  flashTick: number;
  toggleCollapsed: (tableName: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  setTableWidth: (tableName: string, width: number | null) => void;
  resetTableWidths: () => void;
  flashModule: (moduleKey: string) => void;
  clearFlash: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export type AppState = SchemaState & DecisionsState & DisplayState & CanvasState;
