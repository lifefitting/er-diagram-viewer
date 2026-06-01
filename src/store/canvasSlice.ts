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
  nodePositions: {},
  manualRoutes: {},
  deletedTables: {},
  viewport: null,
  flashTables: [],
  flashTick: 0,
  canvasMode: 'select',
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
  setNodePositions(positions) {
    set({ nodePositions: positions });
  },
  setViewport(v) {
    set({ viewport: v });
  },
  setManualRoute(fkKey, points) {
    // Sanitize: reject non-finite coords and round to 1dp so the persisted JSON
    // matches the `routePoints` toFixed(1) encoding (and never emits null).
    if (!points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    const clean = points.map((p) => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
    }));
    set((s) => ({ manualRoutes: { ...s.manualRoutes, [fkKey]: clean } }));
  },
  clearManualRoute(fkKey) {
    set((s) => {
      if (!(fkKey in s.manualRoutes)) return {};
      const next = { ...s.manualRoutes };
      delete next[fkKey];
      return { manualRoutes: next };
    });
  },
  clearManualRoutesForNode(fkKeys) {
    set((s) => {
      const drop = fkKeys.filter((k) => k in s.manualRoutes);
      if (drop.length === 0) return {};
      const next = { ...s.manualRoutes };
      for (const k of drop) delete next[k];
      return { manualRoutes: next };
    });
  },
  clearAllManualRoutes() {
    set((s) => (Object.keys(s.manualRoutes).length === 0 ? {} : { manualRoutes: {} }));
  },
  replaceManualRoutes(routes) {
    set({ manualRoutes: routes });
  },
  pruneManualRoutes(liveKeys) {
    set((s) => {
      const live = new Set(liveKeys);
      const keys = Object.keys(s.manualRoutes);
      if (keys.every((k) => live.has(k))) return {};
      const next: Record<string, { x: number; y: number }[]> = {};
      for (const k of keys) if (live.has(k)) next[k] = s.manualRoutes[k];
      return { manualRoutes: next };
    });
  },
  deleteTables(ids) {
    set((s) => {
      const next = { ...s.deletedTables };
      for (const id of ids) next[id] = true;
      return { deletedTables: next };
    });
  },
  restoreTable(id) {
    set((s) => {
      if (!(id in s.deletedTables)) return {};
      const next = { ...s.deletedTables };
      delete next[id];
      return { deletedTables: next };
    });
  },
  restoreAllTables() {
    set((s) => (Object.keys(s.deletedTables).length === 0 ? {} : { deletedTables: {} }));
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
  setCanvasMode(m) {
    set({ canvasMode: m });
  },
  toggleCanvasMode() {
    set((s) => ({ canvasMode: s.canvasMode === 'pan' ? 'select' : 'pan' }));
  },
});
