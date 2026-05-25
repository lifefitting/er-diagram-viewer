import type { ForeignKey } from '../../parser/types';
import { nodeId } from '../buildGraph';

/**
 * Closed FK neighborhood of a seed set: the seed itself plus every node that
 * shares an edge with any seed node. Pure function — used by both the search
 * highlight and the click-to-focus path.
 */
export function closedNeighborhood(seed: Set<string>, fks: ForeignKey[]): Set<string> {
  const hood = new Set(seed);
  for (const fk of fks) {
    const fromId = nodeId(fk.fromTable);
    const toId = nodeId(fk.toTable);
    if (seed.has(fromId)) hood.add(toId);
    if (seed.has(toId)) hood.add(fromId);
  }
  return hood;
}
