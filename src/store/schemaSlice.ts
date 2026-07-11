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
});
