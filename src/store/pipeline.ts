import { parseSql } from '../parser';
import type { ForeignKey, Schema } from '../parser/types';
import { canonicalFkKey } from '../parser/utils';
import { inferForeignKeys, type InferredFK } from '../infer/inferForeignKeys';
import { inferLogicalLinks } from '../infer/inferLogicalLinks';
import { inferModules, type ModulesResult, type PaletteName } from '../infer/inferModules';
import { mergeShardedTables } from '../infer/mergeShardedTables';

export const EMPTY_MODULES: ModulesResult = { byTable: new Map(), modules: new Map(), ordered: [] };

export function recomputeModules(
  schema: Schema | null,
  inferred: InferredFK[],
  palette: PaletteName,
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
  return inferModules(schema, fks, palette);
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
      canonicalFkKey({ ...fk, fromTable: fk.toTable, fromColumns: fk.toColumns, toTable: fk.fromTable, toColumns: fk.fromColumns }),
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
): { schema: Schema; inferred: InferredFK[]; modules: ModulesResult } {
  const rawSchema = parseSql(sql);
  const merged = mergeShardedTables(rawSchema).schema;
  const inferredFk = inferForeignKeys(merged);

  let inferred: InferredFK[] = inferredFk;
  let schema = merged;
  if (logicalKeys.length > 0) {
    const { consumedColumns, takenKeys } = collectFkExclusions(merged, inferredFk);
    const onlyNames = new Set(logicalKeys.map((k) => k.toLowerCase()));
    const logical = inferLogicalLinks(merged, consumedColumns, takenKeys, onlyNames);
    inferred = [...inferredFk, ...logical.links];
    if (logical.notices.length) {
      schema = { ...merged, notices: [...(merged.notices ?? []), ...logical.notices] };
    }
  }
  const modules = recomputeModules(schema, inferred, palette);
  return { schema, inferred, modules };
}
