import type { Column, Schema, Table } from '../parser/types';
import { typesCompatible } from '../parser/normalizeType';
import { canonicalFkKey, canonicalizeLogicalFk } from '../parser/utils';
import type { InferredFK } from './inferForeignKeys';

/**
 * Logical-link inference: tables in a sharded / multi-database design are
 * often associated through a shared BUSINESS KEY (`out_trade_no`, `order_sn`,
 * …) instead of a physical foreign key — the other service's PK is never
 * stored. This pass clusters columns by exact (lowercased) name across tables
 * and proposes undirected `kind: 'logical'` candidates for review.
 *
 * Deliberately separate from `inferForeignKeys`: that engine resolves each
 * column to a TARGET TABLE by name suffix (`_id`/`_ref`), a per-column →
 * per-table flow. Logical links are a per-column-NAME clustering — a
 * different data flow, kept as a parallel pure function.
 */

/** Column names that recur in nearly every table without carrying an
 *  association meaning — audit columns, tenancy, generic labels. Matching on
 *  these would connect everything to everything. Lowercase. */
export const LOGICAL_KEY_BLACKLIST: ReadonlySet<string> = new Set([
  'id',
  'name',
  'code',
  'type',
  'status',
  'state',
  'created_at',
  'updated_at',
  'deleted_at',
  'create_time',
  'update_time',
  'delete_time',
  'remark',
  'memo',
  'comment',
  'sort',
  'sort_order',
  'seq',
  'version',
  'is_deleted',
  'is_active',
  'enabled',
  'deleted',
  'tenant_id',
  'creator',
  'updater',
  'created_by',
  'updated_by',
  'ext',
  'extra',
  'description',
  'title',
  'uuid',
  'gmt_create',
  'gmt_modified',
]);

/** When a shared column has no unique side, only clusters up to this many
 *  tables get pairwise candidates; larger clusters produce a notice instead
 *  (C(k,2) edges of low confidence would drown the canvas). */
const MAX_PAIRWISE_TABLES = 4;

export interface LogicalLinkResult {
  /** All candidates: `source: 'inferred'`, `kind: 'logical'`, endpoints
   *  pre-ordered by `canonicalizeLogicalFk`. */
  links: InferredFK[];
  /** Human-readable notes for clusters that were deliberately skipped. */
  notices: string[];
}

/** One shared-column cluster surfaced by {@link discoverBusinessKeys} for the
 *  user-facing key picker. */
export interface BusinessKeyCluster {
  /** Lowercased column name (the cluster key, what `onlyNames` matches). */
  name: string;
  /** Tables containing the column (original case, discovery order). */
  tables: string[];
  /** Table whose column is UNIQUE / single-col PK, if any — the star hub. */
  hubTable?: string;
  /** False when picking it would produce no edges (no hub and too many
   *  tables for a pairwise mesh) — shown disabled with an explanation. */
  selectable: boolean;
}

interface Occurrence {
  table: Table;
  col: Column;
}

/**
 * Build the shared-column clusters: lowercased column name → occurrences
 * across tables, blacklist/junk-type filtered and type-bucketed around the
 * cluster's first concrete type (`unknown` joins anything). Exact-name
 * matching only — business keys join on the literal same column name, and
 * fuzzier matching just adds noise. Shared by candidate generation and the
 * user-facing key discovery so the two can never disagree.
 */
function buildClusters(
  schema: Schema,
  excludedColumnNames: ReadonlySet<string>,
): Map<string, Occurrence[]> {
  const byName = new Map<string, Occurrence[]>();
  for (const table of schema.tables) {
    for (const col of table.columns) {
      const name = col.name.toLowerCase();
      if (LOGICAL_KEY_BLACKLIST.has(name)) continue;
      if (excludedColumnNames.has(name)) continue;
      // blob/json columns can't act as join keys.
      if (col.normalizedType === 'blob' || col.normalizedType === 'json') continue;
      let list = byName.get(name);
      if (!list) {
        list = [];
        byName.set(name, list);
      }
      // One occurrence per (table, name) — duplicate column names within one
      // CREATE TABLE are a DDL error the parser tolerates; keep the first.
      if (!list.some((o) => o.table === table)) list.push({ table, col });
    }
  }
  const out = new Map<string, Occurrence[]>();
  for (const [name, all] of byName) {
    if (all.length < 2) continue;
    const concrete = all.find((o) => o.col.normalizedType !== 'unknown');
    const occ = concrete
      ? all.filter((o) => typesCompatible(o.col.normalizedType, concrete.col.normalizedType))
      : all;
    if (occ.length >= 2) out.set(name, occ);
  }
  return out;
}

const isHubCol = (o: Occurrence) =>
  o.col.isUnique || (o.col.isPrimaryKey && o.table.primaryKey.length === 1);

/** Deterministic hub choice: lexicographically smallest unique holder. */
function pickHub(occ: Occurrence[]): Occurrence | undefined {
  return occ.filter(isHubCol).sort((a, b) => a.table.name.localeCompare(b.table.name))[0];
}

/**
 * Survey the schema for shared business-key column clusters WITHOUT
 * generating any edges — feeds the user-facing picker (逻辑关联 → 扫描业务键).
 * Candidate generation is user-triggered and restricted to the names the user
 * picks (see `inferLogicalLinks`'s `onlyNames`): in a large DDL the same
 * column name recurs everywhere, and auto-inferring every cluster floods the
 * canvas — the user's domain knowledge picks the real keys instead.
 */
export function discoverBusinessKeys(
  schema: Schema,
  excludedColumnNames: ReadonlySet<string> = new Set(),
): BusinessKeyCluster[] {
  const clusters: BusinessKeyCluster[] = [];
  for (const [name, occ] of buildClusters(schema, excludedColumnNames)) {
    const hub = pickHub(occ);
    clusters.push({
      name,
      tables: occ.map((o) => o.table.name),
      hubTable: hub?.table.name,
      // No hub + too many tables → a pairwise mesh would be C(k,2) edges of
      // noise; offered disabled so the user knows the cluster exists.
      selectable: !!hub || occ.length <= MAX_PAIRWISE_TABLES,
    });
  }
  // Hub clusters first (strongest signal), then wider clusters, then by name.
  return clusters.sort(
    (a, b) =>
      Number(!!b.hubTable) - Number(!!a.hubTable) ||
      b.tables.length - a.tables.length ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Generate logical-link candidates for the clusters in `onlyNames` (the
 * user-picked business keys — generation is never run un-restricted from the
 * app; the unrestricted form exists for tests/tools).
 *
 * @param excludedColumnNames lowercased column names already consumed by
 *   explicit/inferred FKs (those tables are already transitively associated
 *   through the FK target — pairwise logical edges would be pure noise).
 * @param excludedFkKeys `canonicalFkKey`s of every existing explicit/inferred
 *   FK in BOTH directions — a logical candidate colliding with one is dropped
 *   so buildGraph's route-key collision counts stay a function of rawSql alone.
 * @param onlyNames lowercased column names to generate for; absent = all.
 */
export function inferLogicalLinks(
  schema: Schema,
  excludedColumnNames: ReadonlySet<string> = new Set(),
  excludedFkKeys: ReadonlySet<string> = new Set(),
  onlyNames?: ReadonlySet<string>,
): LogicalLinkResult {
  const links: InferredFK[] = [];
  const notices: string[] = [];

  for (const [name, occ] of buildClusters(schema, excludedColumnNames)) {
    if (onlyNames && !onlyNames.has(name)) continue;

    const hub = pickHub(occ);
    if (hub) {
      // Star topology: hub ~ each other table. medium confidence — the unique
      // side reads as the "owner" of the business key.
      for (const o of occ) {
        if (o === hub) continue;
        pushLink(links, excludedFkKeys, hub, o, 'medium',
          `Shared business key "${name}" across ${occ.length} tables; unique on ${hub.table.name} (hub)`);
      }
    } else if (occ.length <= MAX_PAIRWISE_TABLES) {
      // No unique side: low-confidence pairwise mesh, small clusters only.
      // No index heuristic here — generation only runs for names the user
      // explicitly picked, and that choice replaces the heuristic.
      for (let i = 0; i < occ.length; i++) {
        for (let j = i + 1; j < occ.length; j++) {
          pushLink(links, excludedFkKeys, occ[i], occ[j], 'low',
            `Shared business key "${name}" across ${occ.length} tables (no unique side)`);
        }
      }
    } else {
      notices.push(
        `业务键 "${name}" 出现在 ${occ.length} 张表但没有唯一索引侧，未生成逻辑关联候选（可在推断面板手动连线）。`,
      );
    }
  }

  return { links, notices };
}

function pushLink(
  links: InferredFK[],
  excludedFkKeys: ReadonlySet<string>,
  a: Occurrence,
  b: Occurrence,
  confidence: 'medium' | 'low',
  reason: string,
): void {
  const fk = canonicalizeLogicalFk({
    fromTable: a.table.name,
    fromColumns: [a.col.name],
    toTable: b.table.name,
    toColumns: [b.col.name],
    source: 'inferred',
    kind: 'logical',
    confidence,
    reason,
  }) as InferredFK;
  const key = canonicalFkKey(fk);
  if (excludedFkKeys.has(key)) return;
  if (links.some((l) => canonicalFkKey(l) === key)) return;
  links.push(fk);
}
