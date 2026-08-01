import type { StateCreator } from 'zustand';
import { DEFAULT_PALETTE } from '../infer/inferModules';
import type { AppState, SchemaState } from './types';
import { EMPTY_MODULES, recomputeModules, runPipeline } from './pipeline';
import {
  hasTableOverlap,
  reconcileDerivationSettings,
  reconcileWorkspaceState,
} from './reconcileSqlUpdate';
import { applyColumnOrders, reconcileColumnOrders } from './columnOrder';

/** Schema, inferred FKs, modules. Owns the parse pipeline entry points. */
export const createSchemaSlice: StateCreator<AppState, [], [], SchemaState> = (set, get) => ({
  rawSql: '',
  schema: null,
  inferred: [],
  modules: EMPTY_MODULES,
  palette: DEFAULT_PALETTE,
  logicalKeys: [],
  moduleOverrides: {},
  workspaceGroups: [],
  workspaceEpoch: 0,
  setSql(sql) {
    const { schema, inferred, modules } = runPipeline(sql, get().palette);
    set({
      rawSql: sql,
      schema,
      inferred,
      modules,
      // A new schema invalidates everything keyed on table names. Positions,
      // manual routes and hidden tables are cleared here (import = fresh start)
      // but NOT in `reparse`, so a page refresh keeps the saved arrangement,
      // hand-tuned routes and recycle-bin contents. The picked business keys
      // (`logicalKeys`) are column names of the OLD schema — cleared too.
      decisions: {},
      manualFks: [],
      logicalKeys: [],
      moduleOverrides: {},
      workspaceGroups: [],
      fieldNotes: {},
      collapsed: {},
      tableWidths: {},
      columnOrders: {},
      nodePositions: {},
      manualRoutes: {},
      deletedTables: {},
      viewport: null,
      flashTables: [],
    });
  },
  updateSql(sql) {
    const current = get();
    // First derive the next table set. If it has no stable table in common
    // with the current workspace, preserve setSql's explicit fresh-import
    // semantics instead of carrying unrelated review data across schemas.
    const draft = runPipeline(
      sql,
      current.palette,
      current.logicalKeys,
      current.workspaceGroups,
      current.moduleOverrides,
    );
    if (!hasTableOverlap(current.schema, draft.schema)) {
      current.setSql(sql);
      return;
    }

    // Surviving tables keep their positions, review decisions and other user
    // work. Removed tables/columns/edges are pruned, while newly added tables
    // intentionally have no position so DiagramCanvas can place only them.
    const settings = reconcileDerivationSettings(current, draft.schema);
    const next = runPipeline(
      sql,
      current.palette,
      settings.logicalKeys,
      settings.workspaceGroups,
      settings.moduleOverrides,
    );
    const preserved = reconcileWorkspaceState(current, next.schema, next.inferred, settings);
    set({
      rawSql: sql,
      schema: applyColumnOrders(next.schema, preserved.columnOrders),
      inferred: next.inferred,
      modules: next.modules,
      ...preserved,
    });
  },
  reparse() {
    const sql = get().rawSql;
    if (!sql) return;
    const { schema, inferred, modules } = runPipeline(
      sql,
      get().palette,
      get().logicalKeys,
      get().workspaceGroups,
      get().moduleOverrides,
    );
    const columnOrders = reconcileColumnOrders(get().columnOrders, schema);
    set({ schema: applyColumnOrders(schema, columnOrders), inferred, modules, columnOrders });
  },
  setPalette(p) {
    // A merged import initially keeps each source palette. Once the user picks
    // a palette explicitly, apply it uniformly to every source group so the
    // existing global palette control remains predictable.
    set((s) => {
      const workspaceGroups = s.workspaceGroups.map((group) => ({ ...group, palette: p }));
      return {
        palette: p,
        workspaceGroups,
        modules: recomputeModules(s.schema, s.inferred, p, workspaceGroups, s.moduleOverrides),
      };
    });
  },
  setLogicalKeys(keys) {
    const sql = get().rawSql;
    if (!sql) return;
    // Re-run the pipeline with the new key set — logical candidates are pure
    // derivations of (rawSql, logicalKeys), so this both adds and removes
    // candidates correctly. Decisions keyed on surviving candidates persist.
    const { schema, inferred, modules } = runPipeline(
      sql,
      get().palette,
      keys,
      get().workspaceGroups,
      get().moduleOverrides,
    );
    const columnOrders = reconcileColumnOrders(get().columnOrders, schema);
    set({
      logicalKeys: keys,
      schema: applyColumnOrders(schema, columnOrders),
      inferred,
      modules,
      columnOrders,
    });
  },
  assignTablesToModule(nodeIds, moduleKey) {
    set((s) => {
      const moduleOverrides = { ...s.moduleOverrides };
      for (const id of nodeIds) {
        if (moduleKey === null) delete moduleOverrides[id];
        else moduleOverrides[id] = moduleKey;
      }
      return {
        moduleOverrides,
        modules: recomputeModules(
          s.schema,
          s.inferred,
          s.palette,
          s.workspaceGroups,
          moduleOverrides,
        ),
      };
    });
  },
  importWorkspace(archived) {
    // Replace-the-workspace semantics: every workspace field falls back to the
    // fresh-import default (the same reset list as `setSql`) so nothing from
    // the CURRENT session leaks into the imported one — then the archive's
    // validated fields overlay on top. Personal preferences (theme,
    // sidebarCollapsed) are deliberately NOT restored from the archive: a
    // colleague's dark-mode choice is not part of the review record.
    const { theme: _theme, sidebarCollapsed: _sidebar, ...rest } = archived;
    const palette = rest.palette ?? get().palette;
    const logicalKeys = rest.logicalKeys ?? [];
    const moduleOverrides = rest.moduleOverrides ?? {};
    const workspaceGroups = rest.workspaceGroups ?? [];
    const { schema, inferred, modules } = runPipeline(
      rest.rawSql,
      palette,
      logicalKeys,
      workspaceGroups,
      moduleOverrides,
    );
    const columnOrders = reconcileColumnOrders(rest.columnOrders ?? {}, schema);
    set({
      // fresh-workspace baseline (mirrors setSql's reset list)
      decisions: {},
      manualFks: [],
      fieldNotes: {},
      collapsed: {},
      tableWidths: {},
      nodePositions: {},
      manualRoutes: {},
      deletedTables: {},
      viewport: null,
      flashTables: [],
      // archive payload wins over the baseline where present
      ...rest,
      palette,
      logicalKeys,
      moduleOverrides,
      workspaceGroups,
      columnOrders,
      schema: applyColumnOrders(schema, columnOrders),
      inferred,
      modules,
      // Remount the canvas: replays the refresh-restore path (positions +
      // one-shot camera) against the just-imported layout.
      workspaceEpoch: get().workspaceEpoch + 1,
    });
  },
});
