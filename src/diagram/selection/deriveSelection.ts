import type { ForeignKey, Schema } from '../../parser/types';
import { nodeId } from '../buildGraph';
import type { Selection } from '../types';
import { closedNeighborhood } from './closedNeighborhood';

/**
 * Derive the "what's selected" set from the search box. Match-tests:
 *   - table name
 *   - table comment
 *   - column name
 *   - column comment
 *
 * Returns an empty selection (no matches, no neighborhood) when the search is
 * active but matches nothing — the canvas treats this as "dim everything" so
 * the user can tell the search didn't land.
 */
export function deriveSearchSelection(
  schema: Schema | null,
  fks: ForeignKey[],
  search: string,
): Selection {
  if (!schema) return null;
  const q = search.trim().toLowerCase();
  if (!q) return null;
  const matches = new Set<string>();
  for (const t of schema.tables) {
    const inTable =
      t.name.toLowerCase().includes(q) ||
      (t.comment ?? '').toLowerCase().includes(q) ||
      t.columns.some(
        (c) => c.name.toLowerCase().includes(q) || (c.comment ?? '').toLowerCase().includes(q),
      );
    if (inTable) matches.add(nodeId(t.name));
  }
  if (matches.size === 0) {
    return { matches: new Set(), neighborhood: new Set() };
  }
  return { matches, neighborhood: closedNeighborhood(matches, fks) };
}

/** Derive a click-focus selection (single node + its FK neighborhood). */
export function deriveFocusSelection(
  schema: Schema | null,
  fks: ForeignKey[],
  focusId: string | null,
): Selection {
  if (!schema || !focusId) return null;
  const matches = new Set<string>([focusId]);
  return { matches, neighborhood: closedNeighborhood(matches, fks) };
}
