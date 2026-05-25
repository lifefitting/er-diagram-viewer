import type { ForeignKey, Schema, Table } from '../parser/types';

/**
 * Suffix patterns that mark a table as one shard of a larger logical table.
 *
 * The list is **order-sensitive**: longer / more specific patterns must come
 * before shorter ones, otherwise a name like `t_log_20230101` would be matched
 * by the generic 4-digit pattern (`_0101`) before the 8-digit date pattern
 * (`_20230101`), and we'd produce a wrong base prefix `t_log_2023`.
 *
 * Each pattern is anchored to the end of the name; the matched portion is what
 * `extractShardBase` strips off.
 */
export const SHARD_SUFFIX_PATTERNS: readonly RegExp[] = [
  /_\d{4}_\d{2}_\d{2}$/, // _YYYY_MM_DD
  /_\d{4}_\d{2}$/, // _YYYY_MM
  /_\d{8}$/, // _YYYYMMDD
  /_\d{6}$/, // _YYYYMM
  /_\d{4}$/, // _YYYY (also catches 4-digit shard counters like _0001)
  /_shard\d+$/i, // _shard1
  /_part\d+$/i, // _part1
  /_p\d+$/i, // _p0, _p01, _p15
  /_\d+$/, // _0, _01, _99, _0001, … (catch-all all-numeric suffix)
];

/**
 * If `name` ends with one of the recognized shard suffixes, return the prefix
 * with the suffix stripped (case preserved). Otherwise return null.
 *
 * Examples:
 *   account_detail_202401     -> account_detail
 *   t_log_20230101            -> t_log
 *   users_p15                 -> users
 *   user_profile              -> null
 */
export function extractShardBase(name: string): string | null {
  for (const re of SHARD_SUFFIX_PATTERNS) {
    if (re.test(name)) {
      return name.replace(re, '');
    }
  }
  return null;
}

export interface ShardGroup {
  /** Lower-cased lookup key (used to group shards from different casings). */
  key: string;
  /** Base prefix in original casing (taken from the representative). */
  base: string;
  /** Display name on the canvas: `${base}_*`. */
  displayName: string;
  /** Physical shard table names (sorted). */
  shards: string[];
  /** The table picked as the canonical representative. */
  representative: Table;
}

export interface MergeShardsResult {
  schema: Schema;
  /** One human-readable notice summarizing the merge (empty when nothing merged). */
  notices: string[];
  /** Optional structured info, primarily for tests. */
  groups: ShardGroup[];
}

/**
 * Collapse time- / number-suffixed shard tables into a single representative.
 *
 * Pipeline position: run *between* `parseSql` and `inferForeignKeys` so the
 * downstream FK inference and module detection observe the merged topology
 * (no spurious shard-to-shard edges, no noise modules).
 *
 * Representative selection: pick the shard with the most columns (most
 * complete schema definition wins); ties broken alphabetically for stable
 * output across runs.
 *
 * FK rewriting: any explicit FK referencing a shard (as source or target) is
 * retargeted to the representative. Self-loops introduced by the rewrite
 * (intra-shard FKs collapsing to rep→rep) are dropped. The resulting FK list
 * is deduped on `(from.cols → to.cols)`.
 *
 * Single-shard "groups" (a base with only one matching table) are left
 * untouched — a lone `orders_2024` table is NOT renamed to `orders_*`.
 */
export function mergeShardedTables(schema: Schema): MergeShardsResult {
  // Bucket every shard-suffixed table by its lower-cased base.
  const buckets = new Map<string, Table[]>();
  for (const t of schema.tables) {
    const base = extractShardBase(t.name);
    if (!base) continue;
    const key = base.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }

  const groups: ShardGroup[] = [];
  const dropped = new Set<string>(); // shard table names to remove from the schema
  const rename = new Map<string, string>(); // shard name -> displayName

  for (const [key, members] of buckets) {
    if (members.length < 2) continue;

    const sorted = [...members].sort((a, b) => {
      if (b.columns.length !== a.columns.length) return b.columns.length - a.columns.length;
      return a.name.localeCompare(b.name);
    });
    const rep = sorted[0];
    const base = extractShardBase(rep.name)!;
    const displayName = `${base}_*`;
    const shards = members.map((t) => t.name).sort();

    // Build the rename map BEFORE mutating rep.name, otherwise the rep's original
    // shard name (e.g. account_detail_202401) would be lost and its outbound FKs
    // wouldn't be rewritten to the representative.
    for (const t of members) {
      rename.set(t.name, displayName);
      if (t !== rep) dropped.add(t.name);
    }

    rep.name = displayName;
    rep.shardInfo = { base, shards };

    groups.push({ key, base, displayName, shards, representative: rep });
  }

  if (groups.length === 0) {
    return { schema, notices: [], groups: [] };
  }

  const newTables = schema.tables.filter((t) => !dropped.has(t.name));

  const newFks: ForeignKey[] = [];
  const seen = new Set<string>();
  for (const fk of schema.explicitForeignKeys) {
    const from = rename.get(fk.fromTable) ?? fk.fromTable;
    const to = rename.get(fk.toTable) ?? fk.toTable;
    if (from === to) continue; // intra-shard FK becomes a noise self-loop after rewrite
    const newFk: ForeignKey = { ...fk, fromTable: from, toTable: to };
    const key = `${newFk.fromTable}.${newFk.fromColumns.join(',')}->${newFk.toTable}.${newFk.toColumns.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    newFks.push(newFk);
  }

  const totalMerged = groups.reduce((acc, g) => acc + g.shards.length, 0);
  const summary =
    `合并了 ${groups.length} 组分表（共 ${totalMerged} 张物理表归并为 ${groups.length} 个代表节点）：` +
    groups.map((g) => `${g.displayName}（${g.shards.length} 张）`).join('、');

  return {
    schema: {
      tables: newTables,
      explicitForeignKeys: newFks,
      warnings: schema.warnings,
      notices: [...(schema.notices ?? []), summary],
    },
    notices: [summary],
    groups,
  };
}
