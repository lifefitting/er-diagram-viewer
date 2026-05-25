import type { StateCreator } from 'zustand';
import type { AppState, CanvasState } from './types';

/**
 * Canvas-level UI state: which cards are collapsed, manual width overrides,
 * transient flash highlight, and sidebar collapse state.
 *
 * Why `tableWidths` lives here rather than as DOM state on the overlay: it
 * needs to survive across mount/unmount of `DiagramCanvas` (e.g. when the
 * user toggles the side panel, the canvas re-renders); persisting it through
 * the store also lets the snapshot in sessionStorage pick them up.
 */
export const createCanvasSlice: StateCreator<AppState, [], [], CanvasState> = (set, get) => ({
  sidebarCollapsed: false,
  collapsed: {},
  tableWidths: {},
  flashTables: [],
  flashTick: 0,
  toggleCollapsed(tableName) {
    set((s) => {
      const next = { ...s.collapsed };
      if (next[tableName]) delete next[tableName];
      else next[tableName] = true;
      return { collapsed: next };
    });
  },
  collapseAll() {
    set((s) => {
      if (!s.schema) return {};
      const next: Record<string, boolean> = {};
      for (const t of s.schema.tables) next[t.name] = true;
      return { collapsed: next };
    });
  },
  expandAll() {
    set({ collapsed: {} });
  },
  setTableWidth(tableName, width) {
    set((s) => {
      const next = { ...s.tableWidths };
      if (width == null) delete next[tableName];
      else next[tableName] = Math.round(width);
      return { tableWidths: next };
    });
  },
  resetTableWidths() {
    set({ tableWidths: {} });
  },
  flashModule(moduleKey) {
    const s = get();
    const tables = s.modules.modules.get(moduleKey)?.tables ?? [];
    if (tables.length === 0) return;
    set({ flashTables: tables, flashTick: s.flashTick + 1 });
  },
  clearFlash() {
    set({ flashTables: [] });
  },
  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },
  setSidebarCollapsed(collapsed) {
    set({ sidebarCollapsed: collapsed });
  },
});
