import { nodeId } from '../diagram/nodeId';
import type { InferredFK } from '../infer/inferForeignKeys';
import type { ForeignKey, Schema } from '../parser/types';
import { canonicalFkKey } from '../parser/utils';
import { fieldNoteKey, parseFieldNoteKey } from './notesSlice';
import type { AppState, SchemaState } from './types';

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
  | 'nodePositions'
  | 'manualRoutes'
  | 'deletedTables'
  | 'viewport'
  | 'flashTables'
>;

/** An SQL edit is incremental when at least one stable table id survives. A
 *  completely unrelated schema remains a fresh-workspace import. */
export function hasTableOverlap(current: Schema | null, next: Schema): boolean {
  if (!current || current.tables.length === 0 || next.tables.length === 0) return false;
  const currentIds = new Set(current.tables.map((table) => nodeId(table.name)));
  return next.tables.some((table) => currentIds.has(nodeId(table.name)));
}

/** Settings that participate in pipeline derivation must be pruned before the
 *  final pipeline run, otherwise removed tables can linger in module groups or
 *  obsolete logical-key choices. */
export function reconcileDerivationSettings(
  state: AppState,
  nextSchema: Schema,
): DerivationSettings {
  const liveIds = new Set(nextSchema.tables.map((table) => nodeId(table.name)));
  const liveColumns = new Set(
    nextSchema.tables.flatMap((table) => table.columns.map((column) => column.name.toLowerCase())),
  );

  return {
    logicalKeys: state.logicalKeys.filter((key) => liveColumns.has(key.toLowerCase())),
    moduleOverrides: filterRecord(state.moduleOverrides, (id) => liveIds.has(id)),
    workspaceGroups: state.workspaceGroups
      .map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((id) => liveIds.has(id)),
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
  const tableNames = new Map(nextSchema.tables.map((table) => [nodeId(table.name), table.name]));
  const columns = new Map(
    nextSchema.tables.map((table) => [
      nodeId(table.name),
      new Map(table.columns.map((column) => [column.name.toLowerCase(), column.name])),
    ]),
  );
  const liveIds = new Set(tableNames.keys());

  const manualFks = state.manualFks.flatMap((fk) => {
    const reconciled = reconcileForeignKey(fk, tableNames, columns);
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
    const tableId = nodeId(parsed.table);
    const tableName = tableNames.get(tableId);
    const columnName = columns.get(tableId)?.get(parsed.column.toLowerCase());
    if (tableName && columnName) fieldNotes[fieldNoteKey(tableName, columnName)] = note;
  }

  return {
    ...settings,
    decisions: filterRecord(state.decisions, (key) => liveDecisionKeys.has(key)),
    manualFks,
    fieldNotes,
    collapsed: rekeyTableRecord(state.collapsed, tableNames),
    tableWidths: rekeyTableRecord(state.tableWidths, tableNames),
    nodePositions: filterRecord(state.nodePositions, (id) => liveIds.has(id)),
    manualRoutes: filterRecord(state.manualRoutes, (key) => liveRouteKeys.has(key)),
    deletedTables: filterRecord(state.deletedTables, (id) => liveIds.has(id)),
    viewport: state.viewport,
    flashTables: state.flashTables.flatMap((name) => {
      const nextName = tableNames.get(nodeId(name));
      return nextName ? [nextName] : [];
    }),
  };
}

function reconcileForeignKey(
  fk: ForeignKey,
  tableNames: ReadonlyMap<string, string>,
  columns: ReadonlyMap<string, ReadonlyMap<string, string>>,
): ForeignKey | null {
  const fromId = nodeId(fk.fromTable);
  const toId = nodeId(fk.toTable);
  const fromTable = tableNames.get(fromId);
  const toTable = tableNames.get(toId);
  const fromColumns = fk.fromColumns.map((column) =>
    columns.get(fromId)?.get(column.toLowerCase()),
  );
  const toColumns = fk.toColumns.map((column) => columns.get(toId)?.get(column.toLowerCase()));
  if (
    !fromTable ||
    !toTable ||
    fromColumns.some((column) => !column) ||
    toColumns.some((column) => !column)
  ) {
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

function filterRecord<T>(
  record: Readonly<Record<string, T>>,
  keep: (key: string) => boolean,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keep(key)) next[key] = value;
  }
  return next;
}

function rekeyTableRecord<T>(
  record: Readonly<Record<string, T>>,
  tableNames: ReadonlyMap<string, string>,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [oldName, value] of Object.entries(record)) {
    const nextName = tableNames.get(nodeId(oldName));
    if (nextName) next[nextName] = value;
  }
  return next;
}
