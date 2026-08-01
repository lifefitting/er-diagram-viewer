import type { StateCreator } from 'zustand';
import type { AppState, CanvasState } from './types';
import { visibleSchema } from './selectors';
import { applyColumnOrders, reconcileColumnOrders } from './columnOrder';

type RoutePoint = { x: number; y: number };

/** Rebuild `manualRoutes` keeping only the keys `keep` accepts. Returns an
 *  empty patch (identity-stable no-op) when nothing was dropped, so subscribers
 *  don't re-render needlessly. Shared by every "remove some routes" reducer. */
function filterRoutes(
  routes: Record<string, RoutePoint[]>,
  keep: (key: string) => boolean,
): Partial<CanvasState> {
  const next: Record<string, RoutePoint[]> = {};
  let changed = false;
  for (const [k, v] of Object.entries(routes)) {
    if (keep(k)) next[k] = v;
    else changed = true;
  }
  return changed ? { manualRoutes: next } : {};
}

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
  columnOrders: {},
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
      // Only collapse tables actually on the canvas — recycle-binned tables
      // must not gain a collapse entry (they'd come back collapsed on restore,
      // and the entry would linger in sessionStorage keyed to a hidden name).
      const vis = visibleSchema(s.schema, s.deletedTables);
      if (!vis) return {};
      const next: Record<string, boolean> = {};
      for (const t of vis.tables) next[t.name] = true;
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
  setTableWidths(widths) {
    set((s) => {
      const next = { ...s.tableWidths };
      for (const [tableName, width] of Object.entries(widths)) {
        if (Number.isFinite(width) && width > 0) next[tableName] = Math.round(width);
      }
      return { tableWidths: next };
    });
  },
  resetTableWidths() {
    set({ tableWidths: {} });
  },
  setColumnOrder(tableName, columnNames) {
    set((s) => {
      if (!s.schema) return {};
      const table = s.schema.tables.find((item) => item.name === tableName);
      if (!table) return {};
      const requested = { ...s.columnOrders, [table.name]: [...columnNames] };
      const columnOrders = reconcileColumnOrders(requested, s.schema);
      return {
        columnOrders,
        schema: applyColumnOrders(s.schema, columnOrders),
      };
    });
  },
  setNodePositions(positions) {
    set({ nodePositions: positions });
  },
  setViewport(v) {
    set({ viewport: v });
  },
  setManualRoute(fkKey, points) {
    // Sanitize: a route needs at least its two endpoints, and reject non-finite
    // coords — so we never persist a dead `[]` entry (which would survive in
    // sessionStorage as invisible cruft) or a NaN override. Round to 1dp so the
    // persisted JSON matches the `routePoints` toFixed(1) encoding.
    if (points.length < 2 || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
      return;
    const clean = points.map((p) => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
    }));
    set((s) => ({ manualRoutes: { ...s.manualRoutes, [fkKey]: clean } }));
  },
  clearManualRoute(fkKey) {
    set((s) => filterRoutes(s.manualRoutes, (k) => k !== fkKey));
  },
  clearManualRoutesForNode(fkKeys) {
    const drop = new Set(fkKeys);
    set((s) => filterRoutes(s.manualRoutes, (k) => !drop.has(k)));
  },
  clearAllManualRoutes() {
    set((s) => filterRoutes(s.manualRoutes, () => false));
  },
  replaceManualRoutes(routes) {
    set({ manualRoutes: routes });
  },
  pruneManualRoutes(liveKeys) {
    const live = new Set(liveKeys);
    set((s) => filterRoutes(s.manualRoutes, (k) => live.has(k)));
  },
  deleteTables(ids) {
    set((s) => {
      const next = { ...s.deletedTables };
      // One batch action receives one timestamp so the exported review record
      // faithfully shows that the tables were marked together.
      const updatedAt = new Date().toISOString();
      for (const id of ids) next[id] = { action: 'delete', updatedAt };
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
  flashTable(tableName) {
    set((s) => ({ flashTables: [tableName], flashTick: s.flashTick + 1 }));
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
