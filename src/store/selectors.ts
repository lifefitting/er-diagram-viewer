import type { ForeignKey, Schema } from '../parser/types';
import { fkKey, type InferredFK } from '../infer/inferForeignKeys';
// `nodeId` lives in its own dependency-free module, so importing it here does
// NOT pull the cytoscape-heavy diagram layer into the store/main bundle.
import { nodeId as hiddenKey } from '../diagram/nodeId';

/**
 * The schema with recycle-bin'd tables (and any explicit FK touching one)
 * filtered out — the single "what's actually on the canvas" source, fed to the
 * canvas, the DDL export and the SVG export. Returns the SAME reference when
 * nothing is hidden so memos/identity checks stay cheap. The original SQL and
 * the stored `schema` are never mutated.
 */
export function visibleSchema(
  schema: Schema | null,
  deletedTables: Record<string, true>,
): Schema | null {
  if (!schema || Object.keys(deletedTables).length === 0) return schema;
  return {
    ...schema,
    tables: schema.tables.filter((t) => !deletedTables[hiddenKey(t.name)]),
    explicitForeignKeys: schema.explicitForeignKeys.filter(
      (fk) => !deletedTables[hiddenKey(fk.fromTable)] && !deletedTables[hiddenKey(fk.toTable)],
    ),
  };
}

/**
 * Merge explicit + inferred + manual FKs into the set of edges the UI actually
 * draws.
 *
 *   - explicit FKs are always included.
 *   - inferred FKs respect the user's `decisions[fkKey]`:
 *       * 'reject'  → never drawn.
 *       * 'accept'  → always drawn (even low-confidence ones).
 *       * undefined → drawn unless `confidence === 'low'` AND `showLow=false`.
 *   - manual FKs (user-added) are always included, like explicit ones. They
 *     are validated against the live schema's table set: a stale entry (e.g.
 *     from a hand-edited sessionStorage snapshot) is skipped rather than fed
 *     to the canvas/DDL export.
 *
 * Pure function; called from the canvas, the export-to-DDL menu, and
 * anywhere else that needs the "what FKs are currently visible" answer.
 */
export function effectiveForeignKeys(
  schema: Schema | null,
  inferred: InferredFK[],
  decisions: Record<string, 'accept' | 'reject'>,
  showLow: boolean,
  deletedTables: Record<string, true> = {},
  manualFks: ForeignKey[] = [],
  visibility: { showLogicalLinks?: boolean; showManualLinks?: boolean } = {},
): ForeignKey[] {
  if (!schema) return [];
  // Whole-category visibility toggles (the 隐藏连线/显示连线 buttons on the
  // 逻辑关联 / 手动连线 sections): compare the physical-only picture against
  // the full one without touching any decision.
  const showLogical = visibility.showLogicalLinks ?? true;
  const showManual = visibility.showManualLinks ?? true;
  const out: ForeignKey[] = [...schema.explicitForeignKeys];
  for (const fk of inferred) {
    if (fk.kind === 'logical' && !showLogical) continue;
    const key = fkKey(fk);
    const decision = decisions[key];
    if (decision === 'reject') continue;
    if (fk.confidence === 'low' && !showLow && decision !== 'accept') continue;
    out.push(fk);
  }
  if (manualFks.length > 0 && showManual) {
    const liveTables = new Set(schema.tables.map((t) => t.name.toLowerCase()));
    for (const fk of manualFks) {
      if (!liveTables.has(fk.fromTable.toLowerCase())) continue;
      if (!liveTables.has(fk.toTable.toLowerCase())) continue;
      out.push(fk);
    }
  }
  // Drop any edge touching a recycle-bin'd table (covers inferred edges, which
  // `visibleSchema` can't filter since they aren't on the schema).
  if (Object.keys(deletedTables).length === 0) return out;
  return out.filter(
    (fk) => !deletedTables[hiddenKey(fk.fromTable)] && !deletedTables[hiddenKey(fk.toTable)],
  );
}
