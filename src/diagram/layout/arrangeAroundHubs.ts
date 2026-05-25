import type { Core, NodeSingular } from 'cytoscape';

/** Minimum number of incoming FKs that qualifies a table as a "hub" worthy of
 *  custom radial arrangement. Below this threshold the generic fcose layout
 *  already produces a perfectly fine arrangement. */
const HUB_INDEGREE_THRESHOLD = 3;

/**
 * For each hub table (in-degree >= HUB_INDEGREE_THRESHOLD), place the tables
 * that reference it in a clockwise ring around the hub, sorted by name
 * (ASCII / codepoint order). Runs as a second pass on top of the generic
 * force-directed layout so the macro positions still come from fcose; only
 * the immediate fan-in of each hub gets tidied up.
 *
 * Conflict resolution: hubs are processed in descending in-degree order, and
 * a dependent is claimed by the first hub that arranges it. So if `users`
 * (10 dependents) and `roles` (4 dependents) share a few dependents, those
 * dependents end up around `users` and `roles` arranges only the remainder.
 * This avoids dependents being yanked back and forth between hubs.
 */
export function arrangeAroundHubs(cy: Core) {
  const hubs = cy
    .nodes()
    .toArray()
    .map((n) => ({ node: n, inDeg: n.incomers('edge').length }))
    .filter((h) => h.inDeg >= HUB_INDEGREE_THRESHOLD)
    .sort((a, b) => b.inDeg - a.inDeg);

  if (hubs.length === 0) return;

  const claimed = new Set<string>();
  for (const { node: hub } of hubs) {
    const deps = collectDependents(hub, claimed);
    // The IN-DEGREE threshold already qualified this table as a hub. Here we
    // only require that, after a bigger hub may have claimed some shared
    // dependents, at least 2 dependents remain — fewer than 2 has no angular
    // order to enforce anyway. This way a hub with in-degree 3 whose third
    // dependent is shared with a bigger hub still gets its remaining 2
    // dependents tidied up.
    if (deps.length < 2) continue;

    // ASCII codepoint order — using raw `<` rather than localeCompare so the
    // result is fully deterministic regardless of the user's locale, which
    // matters when the same schema is opened on different machines.
    deps.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const hubPos = hub.position();
    const radius = pickHubRadius(deps, hubPos);

    // Start at -π/2 (12 o'clock) and go clockwise. Clockwise from top is the
    // standard "first-to-last reading order" in LTR cultures, so an
    // alphabetical sequence reads naturally.
    const start = -Math.PI / 2;
    const step = (2 * Math.PI) / deps.length;
    for (let i = 0; i < deps.length; i++) {
      const angle = start + step * i;
      deps[i].node.position({
        x: hubPos.x + radius * Math.cos(angle),
        y: hubPos.y + radius * Math.sin(angle),
      });
      claimed.add(deps[i].node.id());
    }
  }
}

function collectDependents(
  hub: NodeSingular,
  claimed: Set<string>,
): Array<{ node: NodeSingular; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ node: NodeSingular; name: string }> = [];
  hub
    .incomers('edge')
    .sources()
    .forEach((src) => {
      const id = src.id();
      if (id === hub.id()) return; // ignore self-loops
      if (seen.has(id)) return; // dedupe multi-FK from the same table
      if (claimed.has(id)) return; // already placed around a bigger hub
      seen.add(id);
      const name = (src.data('rawName') as string) ?? id;
      out.push({ node: src, name });
    });
  return out;
}

function pickHubRadius(
  deps: Array<{ node: NodeSingular }>,
  hubPos: { x: number; y: number },
): number {
  // The ring's radius is the larger of three candidates:
  //   1) the average distance fcose already placed the dependents at, so we
  //      stay close to the macro layout it computed;
  //   2) a chord-based minimum so the cards on the ring don't crash into
  //      each other — circumference / N must exceed the typical card width;
  //   3) a hard floor so small hubs (e.g. 3 dependents) still feel "around"
  //      the hub rather than glued to it.
  let avg = 0;
  for (const d of deps) {
    const p = d.node.position();
    avg += Math.hypot(p.x - hubPos.x, p.y - hubPos.y);
  }
  avg /= deps.length;
  const CARD_CHORD = 380; // approx avg card width + breathing room
  const minByChord = (deps.length * CARD_CHORD) / (2 * Math.PI);
  const FLOOR = 360;
  return Math.max(avg, minByChord, FLOOR);
}
