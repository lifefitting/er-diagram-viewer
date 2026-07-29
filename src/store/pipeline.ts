import { parseSql } from '../parser';
import type { ForeignKey, Schema } from '../parser/types';
import { canonicalFkKey } from '../parser/utils';
import { inferForeignKeys, type InferredFK } from '../infer/inferForeignKeys';
import { inferLogicalLinks } from '../infer/inferLogicalLinks';
import { inferModules, type ModulesResult, type PaletteName } from '../infer/inferModules';
import { mergeShardedTables } from '../infer/mergeShardedTables';
import { nodeId } from '../diagram/nodeId';
import type { WorkspaceGroup } from './types';

export const EMPTY_MODULES: ModulesResult = { byTable: new Map(), modules: new Map(), ordered: [] };

export function recomputeModules(
  schema: Schema | null,
  inferred: InferredFK[],
  palette: PaletteName,
  workspaceGroups: readonly WorkspaceGroup[] = [],
): ModulesResult {
  if (!schema) return EMPTY_MODULES;
  // Use explicit FKs plus inferred FKs of medium+ confidence so the topology
  // hint is informed by accepted/visible edges, not noisy low-confidence
  // guesses. Logical (business-key) links are excluded entirely: a key like
  // `out_trade_no` spans deliberately-separate domains (orders / payments /
  // refunds), and letting it vote would merge modules that the sharded design
  // intentionally keeps apart.
  const fks: ForeignKey[] = [
    ...schema.explicitForeignKeys,
    ...inferred.filter((f) => f.confidence !== 'low' && f.kind !== 'logical'),
  ];
  if (workspaceGroups.length === 0) return inferModules(schema, fks, palette);

  // A merged workspace keeps module grouping and palette assignment inside
  // each source archive. Without this scope, similarly named tables from two
  // unrelated systems can collapse into one module and both source palettes
  // are lost even though their geometry was preserved.
  const byTable = new Map<string, string>();
  const modules = new Map<string, ModulesResult['ordered'][number]>();
  const ordered: ModulesResult['ordered'] = [];
  const claimed = new Set<string>();

  const append = (result: ModulesResult, prefix: string, groupLabel?: string) => {
    for (const [table, key] of result.byTable) {
      const scopedKey = `${prefix}:${key}`;
      byTable.set(table, scopedKey);
    }
    for (const info of result.ordered) {
      const scopedKey = `${prefix}:${info.name}`;
      const scoped = {
        ...info,
        name: scopedKey,
        label: groupLabel ? `${groupLabel} · ${info.label}` : info.label,
      };
      modules.set(scopedKey, scoped);
      ordered.push(scoped);
    }
  };

  for (const group of workspaceGroups) {
    const ids = new Set(group.nodeIds);
    const scoped = subsetSchema(schema, ids);
    if (scoped.tables.length === 0) continue;
    scoped.tables.forEach((table) => claimed.add(nodeId(table.name)));
    const scopedNames = new Set(scoped.tables.map((table) => table.name));
    const scopedFks = fks.filter(
      (fk) => scopedNames.has(fk.fromTable) && scopedNames.has(fk.toTable),
    );
    append(inferModules(scoped, scopedFks, group.palette), group.id, group.label);
  }

  const ungroupedIds = new Set(
    schema.tables.map((table) => nodeId(table.name)).filter((id) => !claimed.has(id)),
  );
  const ungrouped = subsetSchema(schema, ungroupedIds);
  if (ungrouped.tables.length > 0) {
    const names = new Set(ungrouped.tables.map((table) => table.name));
    append(
      inferModules(
        ungrouped,
        fks.filter((fk) => names.has(fk.fromTable) && names.has(fk.toTable)),
        palette,
      ),
      'workspace',
    );
  }
  return { byTable, modules, ordered };
}

/** Slice a parsed schema by stable cy node ids while retaining only explicit
 *  FKs whose endpoints both belong to that slice. */
function subsetSchema(schema: Schema, nodeIds: ReadonlySet<string>): Schema {
  const tables = schema.tables.filter((table) => nodeIds.has(nodeId(table.name)));
  const names = new Set(tables.map((table) => table.name));
  return {
    ...schema,
    tables,
    explicitForeignKeys: schema.explicitForeignKeys.filter(
      (fk) => names.has(fk.fromTable) && names.has(fk.toTable),
    ),
  };
}

function dedupeFks<T extends ForeignKey>(fks: readonly T[]): T[] {
  const seen = new Set<string>();
  return fks.filter((fk) => {
    const key = canonicalFkKey(fk);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Column names consumed / keys taken by existing FKs (explicit + inferred) —
 * the exclusion inputs for logical-link clustering. Column names an FK already
 * resolved don't need business-key edges (the tables are associated through
 * the FK target), and both key directions are blocked because logical links
 * store lexicographically-ordered endpoints which may equal an FK's reverse.
 * Shared by `runPipeline` and the InferencePanel's key-discovery scan.
 */
export function collectFkExclusions(
  schema: Schema,
  inferredFk: readonly ForeignKey[],
): { consumedColumns: Set<string>; takenKeys: Set<string> } {
  const consumedColumns = new Set<string>();
  const takenKeys = new Set<string>();
  for (const fk of [...schema.explicitForeignKeys, ...inferredFk]) {
    if (fk.kind === 'logical') continue;
    for (const c of fk.fromColumns) consumedColumns.add(c.toLowerCase());
    for (const c of fk.toColumns) consumedColumns.add(c.toLowerCase());
    takenKeys.add(canonicalFkKey(fk));
    takenKeys.add(
      canonicalFkKey({
        ...fk,
        fromTable: fk.toTable,
        fromColumns: fk.toColumns,
        toTable: fk.fromTable,
        toColumns: fk.fromColumns,
      }),
    );
  }
  return { consumedColumns, takenKeys };
}

/**
 * Full SQL → schema pipeline:
 *   parseSql → mergeShardedTables → inferForeignKeys → [inferLogicalLinks] →
 *   inferModules
 *
 * Shard merge runs *before* FK inference so downstream stages observe the
 * merged topology and don't waste effort on shard-to-shard noise edges or
 * spurious shard-named modules.
 *
 * Logical-link clustering is USER-TRIGGERED, not automatic: it only runs for
 * `logicalKeys` — the business-key column names the user picked in the
 * inference panel's scan (persisted, so a refresh re-derives the same
 * candidates; cleared on a new import). An empty list means no logical
 * candidates at all — in a large DDL the same column name recurs everywhere
 * and inferring every cluster on import floods the canvas.
 */
export function runPipeline(
  sql: string,
  palette: PaletteName,
  logicalKeys: readonly string[] = [],
  workspaceGroups: readonly WorkspaceGroup[] = [],
): { schema: Schema; inferred: InferredFK[]; modules: ModulesResult } {
  const rawSchema = parseSql(sql);
  const merged = mergeShardedTables(rawSchema).schema;
  let inferredFk: InferredFK[];
  if (workspaceGroups.length === 0) {
    inferredFk = inferForeignKeys(merged);
  } else {
    const claimed = new Set<string>();
    const scoped: InferredFK[] = [];
    for (const group of workspaceGroups) {
      const ids = new Set(group.nodeIds);
      const part = subsetSchema(merged, ids);
      if (part.tables.length === 0) continue;
      part.tables.forEach((table) => claimed.add(nodeId(table.name)));
      scoped.push(...inferForeignKeys(part));
    }
    const ungrouped = subsetSchema(
      merged,
      new Set(merged.tables.map((table) => nodeId(table.name)).filter((id) => !claimed.has(id))),
    );
    if (ungrouped.tables.length > 0) scoped.push(...inferForeignKeys(ungrouped));
    inferredFk = dedupeFks(scoped) as InferredFK[];
  }

  let inferred: InferredFK[] = inferredFk;
  let schema = merged;
  const logicalLinks: InferredFK[] = [];
  const notices: string[] = [];
  const inferScopedLogical = (part: Schema, keys: readonly string[]) => {
    if (keys.length === 0 || part.tables.length === 0) return;
    const names = new Set(part.tables.map((table) => table.name));
    const partInferred = inferredFk.filter(
      (fk) => names.has(fk.fromTable) && names.has(fk.toTable),
    );
    const { consumedColumns, takenKeys } = collectFkExclusions(part, partInferred);
    const logical = inferLogicalLinks(
      part,
      consumedColumns,
      takenKeys,
      new Set(keys.map((key) => key.toLowerCase())),
    );
    logicalLinks.push(...logical.links);
    notices.push(...logical.notices);
  };

  // `logicalKeys` are deliberate whole-canvas picks made after the merge.
  // Imported keys stay scoped to their source groups to avoid manufacturing
  // cross-workspace business-key links (e.g. a ubiquitous `appid`).
  inferScopedLogical(merged, logicalKeys);
  for (const group of workspaceGroups) {
    inferScopedLogical(subsetSchema(merged, new Set(group.nodeIds)), group.logicalKeys);
  }
  if (logicalLinks.length > 0)
    inferred = dedupeFks([...inferredFk, ...logicalLinks]) as InferredFK[];
  if (notices.length > 0) {
    schema = { ...merged, notices: [...(merged.notices ?? []), ...notices] };
  }
  const modules = recomputeModules(schema, inferred, palette, workspaceGroups);
  return { schema, inferred, modules };
}
