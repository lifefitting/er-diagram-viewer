/**
 * Which cards move together when the user starts dragging card `id`.
 *
 * Grabbing a member of a multi-selection (2+ cards) drags the whole group;
 * grabbing anything else drags just that one card — even if some unrelated
 * multi-selection exists — so a stray selection never hijacks an isolated drag.
 */
export function resolveDragGroup(selected: Set<string>, id: string): string[] {
  return selected.has(id) && selected.size > 1 ? [...selected] : [id];
}

/** Toggle one card's membership in the multi-select set, returning a new Set. */
export function toggleSelected(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
