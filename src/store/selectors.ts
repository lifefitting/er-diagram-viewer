import type { ForeignKey, Schema } from '../parser/types';
import { fkKey, type InferredFK } from '../infer/inferForeignKeys';

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
  return out;
}
