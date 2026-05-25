import { parseSql } from '../parser';
import type { ForeignKey, Schema } from '../parser/types';
import { inferForeignKeys, type InferredFK } from '../infer/inferForeignKeys';
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
  // guesses.
  const fks: ForeignKey[] = [
    ...schema.explicitForeignKeys,
    ...inferred.filter((f) => f.confidence !== 'low'),
  ];
  return inferModules(schema, fks, palette);
}

/**
 * Full SQL → schema pipeline:
 *   parseSql → mergeShardedTables → inferForeignKeys → inferModules
 *
 * Shard merge runs *before* FK inference so downstream stages observe the
 * merged topology and don't waste effort on shard-to-shard noise edges or
 * spurious shard-named modules.
 */
export function runPipeline(
  sql: string,
  palette: PaletteName,
): { schema: Schema; inferred: InferredFK[]; modules: ModulesResult } {
  const rawSchema = parseSql(sql);
  const merged = mergeShardedTables(rawSchema).schema;
  const inferred = inferForeignKeys(merged);
  const modules = recomputeModules(merged, inferred, palette);
  return { schema: merged, inferred, modules };
}
