import { nodeId } from '../diagram/nodeId';
import type { InferredFK } from '../infer/inferForeignKeys';
import type { ForeignKey, Schema, Table } from '../parser/types';
import { canonicalFkKey } from '../parser/utils';
import { fieldNoteKey, parseFieldNoteKey } from './notesSlice';
import type { AppState, SchemaState } from './types';
import { reconcileColumnOrders } from './columnOrder';

type DerivationSettings = Pick<SchemaState, 'logicalKeys' | 'moduleOverrides' | 'workspaceGroups'>;

type PreservedWorkspaceState = Pick<
  AppState,
  | 'decisions'
  | 'manualFks'
  | 'logicalKeys'
  | 'moduleOverrides'
  | 'workspaceGroups'
  | 'fieldNotes'
  | 'collapsed'
  | 'tableWidths'
  | 'columnOrders'
  | 'nodePositions'
  | 'manualRoutes'
  | 'deletedTables'
  | 'viewport'
  | 'flashTables'
>;

/**
 * Identity set for one canvas table: display name plus, when merged, the
 * shard base and every physical shard name. `mergeShardedTables` may rename
 * the representative (`orders_2024` → `orders_*` → `orders`) while these
 * physical identities stay stable — overlap/remap must use them, not the
 * display name alone.
 */
export function tableIdentityIds(table: Table): Set<string> {
  const ids = new Set<string>([nodeId(table.name)]);
  if (table.shardInfo) {
    ids.add(nodeId(table.shardInfo.base));
    for (const shard of table.shardInfo.shards) ids.add(nodeId(shard));
  }
  return ids;
}

/** An SQL edit is incremental when at least one physical/logical table
 *  identity survives (including across shard-merge renames). A completely
 *  unrelated schema remains a fresh-workspace import. */
export function hasTableOverlap(current: Schema | null, next: Schema): boolean {
  if (!current || current.tables.length === 0 || next.tables.length === 0) return false;
  const currentIds = new Set<string>();
  for (const table of current.tables) {
    for (const id of tableIdentityIds(table)) currentIds.add(id);
  }
  for (const table of next.tables) {
    for (const id of tableIdentityIds(table)) {
      if (currentIds.has(id)) return true;
    }
  }
  return false;
}

/**
 * Map each surviving current table's nodeId → next display name. Exact
 * name matches win first; remaining tables pair by identity-set intersection
 * (so a lone `orders_2024` card lands on `orders_*` after the merge
 * threshold). Each next table is claimed at most once.
 */
export function buildTableRemap(
  current: Schema | null,
  next: Schema,
): Map<string, string> {
  const remap = new Map<string, string>();
  if (!current) return remap;

  const nextById = new Map(next.tables.map((table) => [nodeId(table.name), table]));
  const usedNext = new Set<string>();

  for (const table of current.tables) {
    const id = nodeId(table.name);
    const exact = nextById.get(id);
    if (!exact) continue;
    remap.set(id, exact.name);
    usedNext.add(nodeId(exact.name));
  }

  for (const old of current.tables) {
    const oldId = nodeId(old.name);
    if (remap.has(oldId)) continue;
    const oldIds = tableIdentityIds(old);
    let best: Table | null = null;
    let bestScore = 0;
    for (const cand of next.tables) {
      const candId = nodeId(cand.name);
      if (usedNext.has(candId)) continue;
      let score = 0;
      for (const id of tableIdentityIds(cand)) {
        if (oldIds.has(id)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best && bestScore > 0) {
      remap.set(oldId, best.name);
      usedNext.add(nodeId(best.name));
    }
  }

  return remap;
}

/** Settings that participate in pipeline derivation must be pruned before the
 *  final pipeline run, otherwise removed tables can linger in module groups or
 *  obsolete logical-key choices. */
export function reconcileDerivationSettings(
  state: AppState,
  nextSchema: Schema,
): DerivationSettings {
  const remap = buildTableRemap(state.schema, nextSchema);
  const liveColumns = new Set(
    nextSchema.tables.flatMap((table) => table.columns.map((column) => column.name.toLowerCase())),
  );

  return {
    logicalKeys: state.logicalKeys.filter((key) => liveColumns.has(key.toLowerCase())),
    moduleOverrides: rekeyNodeIdRecord(state.moduleOverrides, remap),
    workspaceGroups: state.workspaceGroups
      .map((group) => ({
        ...group,
        nodeIds: group.nodeIds.flatMap((id) => {
          const nextName = remap.get(id);
          return nextName ? [nodeId(nextName)] : [];
        }),
      }))
      .filter((group) => group.nodeIds.length > 0),
  };
}

/** Preserve user work for surviving tables while pruning references made
 *  invalid by an SQL edit. New tables deliberately have no saved position;
 *  the canvas places only those cards without touching the existing layout. */
export function reconcileWorkspaceState(
  state: AppState,
  nextSchema: Schema,
  nextInferred: InferredFK[],
  settings: DerivationSettings,
): PreservedWorkspaceState {
  const remap = buildTableRemap(state.schema, nextSchema);
  const columns = new Map(
    nextSchema.tables.map((table) => [
      nodeId(table.name),
      new Map(table.columns.map((column) => [column.name.toLowerCase(), column.name])),
    ]),
  );

  const manualFks = state.manualFks.flatMap((fk) => {
    const reconciled = reconcileForeignKey(fk, remap, columns);
    return reconciled ? [reconciled] : [];
  });
  const liveDecisionKeys = new Set(nextInferred.map(canonicalFkKey));
  const liveRouteKeys = new Set(
    [...nextSchema.explicitForeignKeys, ...nextInferred, ...manualFks].map(canonicalFkKey),
  );

  const fieldNotes: AppState['fieldNotes'] = {};
  for (const [key, note] of Object.entries(state.fieldNotes)) {
    const parsed = parseFieldNoteKey(key);
    if (!parsed) continue;
    const nextTable = remap.get(nodeId(parsed.table));
    if (!nextTable) continue;
    const columnName = columns.get(nodeId(nextTable))?.get(parsed.column.toLowerCase());
    if (columnName) fieldNotes[fieldNoteKey(nextTable, columnName)] = note;
  }

  const remappedOrders = rekeyTableRecord(state.columnOrders, remap);

  return {
    ...settings,
    decisions: remapFkKeyedRecord(state.decisions, remap, liveDecisionKeys),
    manualFks,
    fieldNotes,
    collapsed: rekeyTableRecord(state.collapsed, remap),
    tableWidths: rekeyTableRecord(state.tableWidths, remap),
    columnOrders: reconcileColumnOrders(remappedOrders, nextSchema),
    nodePositions: rekeyNodeIdRecord(state.nodePositions, remap),
    manualRoutes: remapFkKeyedRecord(state.manualRoutes, remap, liveRouteKeys),
    deletedTables: rekeyNodeIdRecord(state.deletedTables, remap),
    viewport: state.viewport,
    flashTables: state.flashTables.flatMap((name) => {
      const nextName = remap.get(nodeId(name));
      return nextName ? [nextName] : [];
    }),
  };
}

function reconcileForeignKey(
  fk: ForeignKey,
  remap: ReadonlyMap<string, string>,
  columns: ReadonlyMap<string, ReadonlyMap<string, string>>,
): ForeignKey | null {
  const fromTable = remap.get(nodeId(fk.fromTable));
  const toTable = remap.get(nodeId(fk.toTable));
  if (!fromTable || !toTable) return null;
  const fromId = nodeId(fromTable);
  const toId = nodeId(toTable);
  const fromColumns = fk.fromColumns.map((column) =>
    columns.get(fromId)?.get(column.toLowerCase()),
  );
  const toColumns = fk.toColumns.map((column) => columns.get(toId)?.get(column.toLowerCase()));
  if (fromColumns.some((column) => !column) || toColumns.some((column) => !column)) {
    return null;
  }
  return {
    ...fk,
    fromTable,
    toTable,
    fromColumns: fromColumns as string[],
    toColumns: toColumns as string[],
  };
}

/** Rewrite fk-keyed records (`decisions`, `manualRoutes`) across table renames.
 *  Both endpoint orders are tried so logical keys (order-normalized) still hit. */
function remapFkKeyedRecord<T>(
  record: Readonly<Record<string, T>>,
  remap: ReadonlyMap<string, string>,
  liveKeys: ReadonlySet<string>,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const hit = fkKeyCandidates(key, remap).find((candidate) => liveKeys.has(candidate));
    if (hit !== undefined) next[hit] = value;
  }
  return next;
}

function fkKeyCandidates(key: string, remap: ReadonlyMap<string, string>): string[] {
  const arrow = key.indexOf('->');
  if (arrow < 0) return [];
  const left = key.slice(0, arrow);
  const right = key.slice(arrow + 2);
  const leftDot = left.indexOf('.');
  const rightDot = right.indexOf('.');
  if (leftDot < 0 || rightDot < 0) return [];

  const fromNext = remap.get(nodeId(left.slice(0, leftDot)));
  const toNext = remap.get(nodeId(right.slice(0, rightDot)));
  if (!fromNext || !toNext) return [];

  const fromCols = left.slice(leftDot + 1);
  const toCols = right.slice(rightDot + 1);
  const a = `${fromNext}.${fromCols}`.toLowerCase();
  const b = `${toNext}.${toCols}`.toLowerCase();
  if (a === b) return [`${a}->${b}`];
  return [`${a}->${b}`, `${b}->${a}`];
}

function rekeyNodeIdRecord<T>(
  record: Readonly<Record<string, T>>,
  remap: ReadonlyMap<string, string>,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [oldId, value] of Object.entries(record)) {
    const nextName = remap.get(oldId);
    if (nextName) next[nodeId(nextName)] = value;
  }
  return next;
}

function rekeyTableRecord<T>(
  record: Readonly<Record<string, T>>,
  remap: ReadonlyMap<string, string>,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [oldName, value] of Object.entries(record)) {
    const nextName = remap.get(nodeId(oldName));
    if (nextName) next[nextName] = value;
  }
  return next;
}
