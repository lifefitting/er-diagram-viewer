import type { ForeignKey, Schema } from '../parser/types';
import { fkKey, type InferredFK } from '../infer/inferForeignKeys';

/** cy node id for a table name. Inlined (mirrors `buildGraph.nodeId`) so the
 *  store has no import edge into the diagram layer. `deletedTables` is keyed by
 *  this. */
function hiddenKey(name: string): string {
  return 't:' + name.toLowerCase();
}

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
 * Merge explicit + inferred FKs into the set of edges the UI actually draws.
 *
 *   - explicit FKs are always included.
 *   - inferred FKs respect the user's `decisions[fkKey]`:
 *       * 'reject'  → never drawn.
 *       * 'accept'  → always drawn (even low-confidence ones).
 *       * undefined → drawn unless `confidence === 'low'` AND `showLow=false`.
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
): ForeignKey[] {
  if (!schema) return [];
  const out: ForeignKey[] = [...schema.explicitForeignKeys];
  for (const fk of inferred) {
    const key = fkKey(fk);
    const decision = decisions[key];
    if (decision === 'reject') continue;
    if (fk.confidence === 'low' && !showLow && decision !== 'accept') continue;
    out.push(fk);
  }
  // Drop any edge touching a recycle-bin'd table (covers inferred edges, which
  // `visibleSchema` can't filter since they aren't on the schema).
  if (Object.keys(deletedTables).length === 0) return out;
  return out.filter(
    (fk) => !deletedTables[hiddenKey(fk.fromTable)] && !deletedTables[hiddenKey(fk.toTable)],
  );
}
