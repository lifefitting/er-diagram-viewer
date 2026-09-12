import type { StateCreator } from 'zustand';
import { DEFAULT_PALETTE } from '../infer/inferModules';
import type { AppState, SchemaState } from './types';
import {
  derivePipeline,
  EMPTY_MODULES,
  parseAndMergeSql,
  recomputeModules,
  runPipeline,
} from './pipeline';
import {
  hasTableOverlap,
  reconcileDerivationSettings,
  reconcileWorkspaceState,
} from './reconcileSqlUpdate';
import { applyColumnOrders, reconcileColumnOrders } from './columnOrder';
import {
  normalizeModuleLabel,
  validModuleLabel,
  validModuleColor,
} from '../infer/moduleCustomization';
import { nodeId } from '../diagram/nodeId';

/** Schema, inferred FKs, modules. Owns the parse pipeline entry points. */
export const createSchemaSlice: StateCreator<AppState, [], [], SchemaState> = (set, get) => ({
  rawSql: '',
  schema: null,
  inferred: [],
  modules: EMPTY_MODULES,
  palette: DEFAULT_PALETTE,
  logicalKeys: [],
  moduleOverrides: {},
  customModules: {},
  moduleColors: {},
  workspaceGroups: [],
  workspaceEpoch: 0,
  setSql(sql) {
    const { schema, inferred, modules } = runPipeline(sql, get().palette);
    if (schema.tables.length === 0) {
      throw new Error('未解析出任何表：请确认粘贴的是 CREATE TABLE / ALTER TABLE 脚本');
    }
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
      customModules: {},
      moduleColors: {},
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
    // Parse/merge once. If it has no stable table in common
    // with the current workspace, preserve setSql's explicit fresh-import
    // semantics instead of carrying unrelated review data across schemas.
    const merged = parseAndMergeSql(sql);
    if (merged.tables.length === 0) {
      throw new Error('未解析出任何表：请确认粘贴的是 CREATE TABLE / ALTER TABLE 脚本');
    }
    if (!hasTableOverlap(current.schema, merged)) {
      current.setSql(sql);
      return;
    }

    // Surviving tables keep their positions, review decisions and other user
    // work. Removed tables/columns/edges are pruned, while newly added tables
    // intentionally have no position so DiagramCanvas can place only them.
    const settings = reconcileDerivationSettings(current, merged);
    const next = derivePipeline(
      merged,
      current.palette,
      settings.logicalKeys,
      settings.workspaceGroups,
      settings.moduleOverrides,
      settings,
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
      get(),
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
      const customModules = Object.fromEntries(
        Object.entries(s.customModules).map(([key, definition]) => [
          key,
          { ...definition, palette: p },
        ]),
      );
      return {
        palette: p,
        workspaceGroups,
        customModules,
        modules: recomputeModules(s.schema, s.inferred, p, workspaceGroups, s.moduleOverrides, {
          customModules,
          moduleColors: s.moduleColors,
        }),
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
      get(),
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
      if (
        moduleKey !== null &&
        !s.modules.modules.has(moduleKey) &&
        !Object.hasOwn(s.customModules, moduleKey)
      )
        return s;
      const liveIds = new Set(s.schema?.tables.map((table) => nodeId(table.name)));
      const moduleOverrides = { ...s.moduleOverrides };
      for (const id of nodeIds) {
        if (!liveIds.has(id)) continue;
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
          s,
        ),
      };
    });
  },
  createModuleForTables(nodeIds, input) {
    const label = normalizeModuleLabel(input);
    if (!validModuleLabel(label))
      throw new Error('模块名称需为 1–64 个字符，且不能包含换行或控制字符');
    const s = get();
    const liveIds = new Set(s.schema?.tables.map((table) => nodeId(table.name)));
    const ids = nodeIds.filter((id) => liveIds.has(id));
    if (ids.length === 0) throw new Error('请先选择要归入模块的表');
    const comparable = label.toLowerCase();
    const matches = new Set([
      ...s.modules.ordered.filter((m) => m.label.toLowerCase() === comparable).map((m) => m.name),
      ...Object.entries(s.customModules)
        .filter(([, m]) => m.label.toLowerCase() === comparable)
        .map(([key]) => key),
    ]);
    if (matches.size > 1) throw new Error('存在多个同名模块，请从下拉列表选择目标，或输入不同名称');
    const existing = [...matches][0];
    // getRandomValues also works on non-HTTPS intranet deployments, where
    // randomUUID is unavailable. The id is storage identity, never UI text.
    const key =
      existing ??
      `custom:${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')}`;
    const customModules = existing
      ? s.customModules
      : {
          ...s.customModules,
          [key]: {
            label,
            palette: s.palette,
            colorIndex: s.modules.ordered.length + Object.keys(s.customModules).length,
          },
        };
    const moduleOverrides = {
      ...s.moduleOverrides,
      ...Object.fromEntries(ids.map((id) => [id, key])),
    };
    set({
      customModules,
      moduleOverrides,
      modules: recomputeModules(
        s.schema,
        s.inferred,
        s.palette,
        s.workspaceGroups,
        moduleOverrides,
        { customModules, moduleColors: s.moduleColors },
      ),
    });
    return key;
  },
  setModuleColor(moduleKey, color) {
    if (color !== null && !validModuleColor(color))
      throw new Error('请输入六位 HEX 色值，例如 #087f8c');
    set((s) => {
      if (!s.modules.modules.has(moduleKey)) return s;
      const moduleColors = { ...s.moduleColors };
      if (color === null) delete moduleColors[moduleKey];
      else moduleColors[moduleKey] = color.toLowerCase();
      return {
        moduleColors,
        modules: recomputeModules(
          s.schema,
          s.inferred,
          s.palette,
          s.workspaceGroups,
          s.moduleOverrides,
          { customModules: s.customModules, moduleColors },
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
    const customModules = rest.customModules ?? {};
    const moduleColors = rest.moduleColors ?? {};
    const workspaceGroups = rest.workspaceGroups ?? [];
    const { schema, inferred, modules } = runPipeline(
      rest.rawSql,
      palette,
      logicalKeys,
      workspaceGroups,
      moduleOverrides,
      { customModules, moduleColors },
    );
    if (schema.tables.length === 0) {
      throw new Error('存档中未解析出任何表');
    }
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
      customModules,
      moduleColors,
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
