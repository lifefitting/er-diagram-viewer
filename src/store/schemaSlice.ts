import type { StateCreator } from 'zustand';
import { DEFAULT_PALETTE } from '../infer/inferModules';
import type { AppState, SchemaState } from './types';
import { EMPTY_MODULES, recomputeModules, runPipeline } from './pipeline';

/** Schema, inferred FKs, modules. Owns the parse pipeline entry points. */
export const createSchemaSlice: StateCreator<AppState, [], [], SchemaState> = (set, get) => ({
  rawSql: '',
  schema: null,
  inferred: [],
  modules: EMPTY_MODULES,
  palette: DEFAULT_PALETTE,
  logicalKeys: [],
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
      fieldNotes: {},
      collapsed: {},
      tableWidths: {},
      nodePositions: {},
      manualRoutes: {},
      deletedTables: {},
      viewport: null,
      flashTables: [],
    });
  },
  reparse() {
    const sql = get().rawSql;
    if (!sql) return;
    const { schema, inferred, modules } = runPipeline(sql, get().palette, get().logicalKeys);
    set({ schema, inferred, modules });
  },
  setPalette(p) {
    // Recolor modules in place; assignment is palette-independent so byTable stays valid.
    set((s) => ({ palette: p, modules: recomputeModules(s.schema, s.inferred, p) }));
  },
  setLogicalKeys(keys) {
    const sql = get().rawSql;
    if (!sql) return;
    // Re-run the pipeline with the new key set — logical candidates are pure
    // derivations of (rawSql, logicalKeys), so this both adds and removes
    // candidates correctly. Decisions keyed on surviving candidates persist.
    const { schema, inferred, modules } = runPipeline(sql, get().palette, keys);
    set({ logicalKeys: keys, schema, inferred, modules });
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
    const { schema, inferred, modules } = runPipeline(rest.rawSql, palette, logicalKeys);
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
      schema,
      inferred,
      modules,
      // Remount the canvas: replays the refresh-restore path (positions +
      // one-shot camera) against the just-imported layout.
      workspaceEpoch: get().workspaceEpoch + 1,
    });
  },
});
