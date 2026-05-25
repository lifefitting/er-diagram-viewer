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
  setSql(sql) {
    const { schema, inferred, modules } = runPipeline(sql, get().palette);
    set({
      rawSql: sql,
      schema,
      inferred,
      modules,
      // A new schema invalidates everything keyed on table names.
      decisions: {},
      collapsed: {},
      tableWidths: {},
      flashTables: [],
    });
  },
  reparse() {
    const sql = get().rawSql;
    if (!sql) return;
    const { schema, inferred, modules } = runPipeline(sql, get().palette);
    set({ schema, inferred, modules });
  },
  setPalette(p) {
    // Recolor modules in place; assignment is palette-independent so byTable stays valid.
    set((s) => ({ palette: p, modules: recomputeModules(s.schema, s.inferred, p) }));
  },
});
