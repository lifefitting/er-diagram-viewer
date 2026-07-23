import * as dagre from '@dagrejs/dagre';
import type { Core, NodeCollection } from 'cytoscape';

/**
 * Publication ("print") layout: a *semantic* layered left-to-right arrangement
 * (dagre) whose generous rank gaps act as routing channels. We run dagre
 * directly (rather than via cytoscape-dagre) so we can read the RAW edge
 * `points` -- the centerline that threads through dagre's reserved, node-free
 * channels. Those waypoints are stashed on each edge as `dagreWaypoints`;
 * `updateEdgeEndpoints` later docks them to the field-row ports and
 * orthogonalises the path, so no connector crosses a card body.
 *
 * What makes it "semantic" (see LAYOUT_EXECUTION_PLAN.md):
 *
 *  - Direction: real FKs point child -> parent (orders.user_id -> users.id).
 *    For layout we want the referenced (parent) tables to rank earliest and sit
 *    on the LEFT, with detail/child tables flowing rightward. So the temporary
 *    dagre edge is reversed to parent -> child. The real Cytoscape edge and its
 *    arrow are untouched; only the dagre ranking edge is flipped, and the
 *    resulting waypoints are reversed back to the child -> parent order that
 *    `updateEdgeEndpoints` expects.
 *
 *  - Weights, not exclusion: strong relations (explicit > accepted >
 *    high-confidence inferred) get heavy weights so they dominate rank
 *    placement; noisy pending medium/low inferred FKs get a near-zero weight so
 *    they barely distort the ranking -- yet they are STILL added to the graph
 *    so dagre reserves a node-free channel for them and they route cleanly.
 *    Same-module edges are boosted so a module stays clustered.
 *
 *  - Parallel collapse: multiple FKs between the same table pair share one
 *    dagre ranking edge (and one channel polyline); they fan out only near
 *    their field-row ports.
 *
 *  - Isolated tables: tables with no visible FK are packed into a compact grid
 *    below the main graph instead of being strewn through rank 0.
 *
 * Self-loops are skipped here (dagre can't rank them); updateEdgeEndpoints
 * routes them as a U-shape on the card's right side.
 *
 * Module compound parents are ignored (pure layered layout); module colour
 * still comes from node data, not parent nodes.
 */

const RANK_SEP = 220; // gap between ranks (columns) -> the routing channels
const NODE_SEP = 80; // gap between nodes within a rank
const EDGE_SEP = 24;
const ISO_GAP = 60; // gap around the isolated-table grid

/** Per-edge ranking weight inputs. Stronger relations pull endpoints closer. */
export interface LayoutEdgeMeta {
  /** 'explicit' (declared in DDL), 'inferred', or 'manual' (user-added). */
  source: 'explicit' | 'inferred' | 'manual';
  /** 'logical' = business-key association: kept in the layout graph (so its
   *  tables don't fall into the isolated grid) but at a LOW weight regardless
   *  of source — a manual logical link must not pull like a manual FK.
   *  Absent = 'fk'. */
  kind?: 'fk' | 'logical';
  /** Inferred confidence tier; explicit FKs report 'high'. */
  confidence: 'high' | 'medium' | 'low';
  /** Solid = explicit OR user-accepted; dashed = pending. */
  accepted: boolean;
  /** Both endpoints in the same module. */
  sameModule: boolean;
}

/**
 * Weight for a layout edge. Heavier = dagre keeps it shorter/straighter, so it
 * dominates rank placement. The tiers encode the plan's priority
 * (explicit > accepted > high > pending) and a same-module boost. Pending
 * medium/low get a deliberately tiny weight: present (so a channel is reserved
 * and the table isn't orphaned) but too light to distort the strong skeleton.
 */
export function layoutEdgeWeight(m: LayoutEdgeMeta): number {
  // Logical links short-circuit BEFORE the source tiers: even a manual one
  // must stay light, or a business key spanning domains would fold the
  // FK-derived ranking into itself.
  if (m.kind === 'logical') return (m.accepted ? 2 : 0.5) * (m.sameModule ? 1.8 : 1);
  let base: number;
  // Manual FKs are user-declared — as authoritative as explicit ones.
  if (m.source === 'explicit' || m.source === 'manual') base = 16;
  else if (m.accepted) base = 8;
  else if (m.confidence === 'high') base = 4;
  else if (m.confidence === 'medium') base = 1;
  else base = 0.4;
  return m.sameModule ? base * 1.8 : base;
}

/** A real (child -> parent) FK reduced to its layout-relevant fields. */
export interface RawLayoutEdge {
  id: string; // the real Cytoscape edge id
  child: string; // FK column holder (source) -> ranks later (right)
  parent: string; // referenced table (target) -> ranks earlier (left)
  weight: number;
}

export interface LayoutPair {
  parent: string; // dagre v
  child: string; // dagre w
  weight: number; // accumulated across collapsed parallel edges
  members: string[]; // real edge ids sharing this ranking edge / channel
}

/** Stable map key for an ordered (parent, child) layout pair. */
export function pairKey(parent: string, child: string): string {
  return `${parent} ${child}`;
}

/**
 * Collapse parallel child -> parent FKs into one ranking edge per ordered pair,
 * keyed in the layout (parent -> child) direction. Weights accumulate so a
 * heavily-referenced pair pulls harder; `members` lets callers copy the
 * resulting channel waypoints back onto every real edge of the pair. Self-loops
 * are dropped (they can't be ranked).
 */
export function collapseLayoutPairs(edges: RawLayoutEdge[]): Map<string, LayoutPair> {
  const pairs = new Map<string, LayoutPair>();
  for (const e of edges) {
    if (e.child === e.parent) continue; // self-loop: routed as a U-shape later
    const key = pairKey(e.parent, e.child);
    const existing = pairs.get(key);
    if (existing) {
      existing.weight += e.weight;
      existing.members.push(e.id);
    } else {
      pairs.set(key, { parent: e.parent, child: e.child, weight: e.weight, members: [e.id] });
    }
  }
  return pairs;
}

/**
 * dagre's network-simplex ranker has a floating-point bug: FRACTIONAL edge
 * weights (our ×1.8 same-module multiplier yields 1.8 / 7.2 / 0.72 …) can
 * leave cutvalue comparisons with precision noise, so `leaveEdge` picks a
 * "negative-cutvalue" edge for which `enterEdge` then finds no candidate —
 * and its no-initial-value `.reduce()` throws "Reduce of empty array…"
 * (present up to @dagrejs/dagre 3.0.0, the latest as of 2026-07).
 *
 * Dagre weights only matter relative to each other, so the real fix is to
 * hand dagre INTEGERS: every `layoutEdgeWeight` tier is a multiple of 0.02,
 * so ×50 makes them all whole numbers with the exact same ratios. Applied at
 * the dagre boundary (not inside `layoutEdgeWeight`) because the fractional
 * tiers are a readable priority language; the integer requirement is purely
 * a dagre workaround.
 */
const WEIGHT_SCALE = 50;

/** The one dagre failure we recover from (see WEIGHT_SCALE); anything else
 *  is an unknown bug and must surface, not silently degrade the layout. */
export function isEmptyReduceError(err: unknown): boolean {
  return err instanceof Error && /reduce of empty array/i.test(err.message);
}

/**
 * Run dagre.layout; on the known network-simplex empty-reduce throw, retry
 * with the `tight-tree` ranker. WEIGHT_SCALE should make this path
 * unreachable, but the upstream bug's exact trigger set isn't proven — a
 * degraded-but-complete layout beats a blank canvas. Safe to retry on the
 * same graph: dagre computes on an internal copy and only writes back on
 * success, so a throw leaves the input untouched.
 */
export function layoutDagreGraph(g: dagre.graphlib.Graph): void {
  try {
    dagre.layout(g);
  } catch (err) {
    if (!isEmptyReduceError(err)) throw err;
    g.setGraph({ ...g.graph(), ranker: 'tight-tree' });
    dagre.layout(g);
  }
}

export function arrangeForPublication(cy: Core): void {
  const tables = cy.nodes('[type = "table"]');
  if (tables.length === 0) return;

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: 'LR',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: EDGE_SEP,
    ranker: 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));

  const allEdges = cy.edges();

  // Reduce each real (child -> parent) FK to a weighted layout edge, then
  // collapse parallels. The dagre edge is set parent -> child (reversed) so the
  // referenced/parent tables rank earliest and sit on the LEFT.
  const rawEdges: RawLayoutEdge[] = allEdges.map((e) => ({
    id: e.id(),
    child: e.source().id(), // FK column holder
    parent: e.target().id(), // referenced table
    weight: layoutEdgeWeight({
      source: (e.data('meta')?.source as LayoutEdgeMeta['source']) ?? 'inferred',
      kind: (e.data('kind') as LayoutEdgeMeta['kind']) ?? 'fk',
      confidence: (e.data('confidence') as 'high' | 'medium' | 'low') ?? 'medium',
      accepted: e.data('lineStyle') === 'solid',
      sameModule: e.data('crossModule') === 'no',
    }),
  }));
  const pairs = collapseLayoutPairs(rawEdges);

  // Tables touched by a cross-table FK go into dagre; everything else is
  // grid-placed below. CRITICAL: isolated tables must NOT be added to the dagre
  // graph — with a mostly-disconnected schema (few FKs, many standalone tables)
  // dagre stacks every edgeless node into a tall rank-0 column, which inflates
  // the connected nodes' coordinates and leaves a huge empty vertical gap the
  // camera then centers on (blank canvas on import). Feeding dagre only the
  // connected subgraph keeps it compact; the isolated grid sits right below it.
  // A self-loop is not a cross-table edge (collapseLayoutPairs drops it), so a
  // self-loop-only table is treated as isolated — it still routes its U-loop.
  const connected = new Set<string>();
  pairs.forEach((p) => {
    connected.add(p.parent);
    connected.add(p.child);
  });

  tables.forEach((n) => {
    if (!connected.has(n.id())) return;
    g.setNode(n.id(), {
      width: (n.data('boxWidth') as number) ?? 240,
      height: (n.data('boxHeight') as number) ?? 80,
    });
  });

  pairs.forEach((p, key) => {
    // Math.round soaks up float noise from summing fractional tiers in
    // collapseLayoutPairs (e.g. 0.4 * 1.8 * 50 = 36.000000000000006).
    g.setEdge(p.parent, p.child, { weight: Math.round(p.weight * WEIGHT_SCALE), minlen: 1 }, key);
  });

  layoutDagreGraph(g);

  cy.batch(() => {
    let maxX = -Infinity;
    let maxY = -Infinity;
    const isolated = tables.filter((n) => !connected.has(n.id()));

    tables.forEach((n) => {
      if (!connected.has(n.id())) return; // placed in the grid below
      const dn = g.node(n.id());
      if (dn) {
        n.position({ x: dn.x, y: dn.y });
        maxX = Math.max(maxX, dn.x + (dn.width ?? 0) / 2);
        maxY = Math.max(maxY, dn.y + (dn.height ?? 0) / 2);
      }
    });

    placeIsolatedGrid(isolated, maxX, maxY);

    allEdges.forEach((e) => {
      const child = e.source().id();
      const parent = e.target().id();
      if (child === parent) {
        e.removeData('dagreWaypoints');
        return;
      }
      const de = g.edge({ v: parent, w: child, name: pairKey(parent, child) });
      // Interior points only -- first/last sit on the node boundaries and are
      // replaced by the field-row ports in updateEdgeEndpoints. dagre's points
      // run parent -> child; the real edge is child -> parent, so reverse them
      // so [childPort, ...waypoints, parentPort] stays monotone. The presence
      // of the (possibly empty) array is the "use channel routing" flag.
      const interior =
        de && de.points && de.points.length > 2
          ? de.points
              .slice(1, -1)
              .map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }))
              .reverse()
          : [];
      e.data('dagreWaypoints', interior);
    });
  });
}

/**
 * Pack tables with no visible FK into a compact grid below the main graph, so
 * they don't get strewn through dagre's rank 0. Columns are sized to the widest
 * isolated card; rows stack downward. Pure positioning, no routing implications
 * (these tables have no edges).
 */
function placeIsolatedGrid(isolated: NodeCollection, mainMaxX: number, mainMaxY: number): void {
  if (isolated.length === 0) return;
  const startY = (Number.isFinite(mainMaxY) ? mainMaxY : 0) + ISO_GAP * 2;
  const startX = Number.isFinite(mainMaxX) ? Math.min(0, mainMaxX) : 0;
  // Aim for a roughly square-ish block.
  const cols = Math.max(1, Math.ceil(Math.sqrt(isolated.length)));
  const widths = isolated.map((n) => (n.data('boxWidth') as number) ?? 240);
  const colW = Math.max(...widths) + NODE_SEP;
  let col = 0;
  let rowH = 0;
  let cursorY = startY;
  isolated.forEach((n) => {
    const w = (n.data('boxWidth') as number) ?? 240;
    const h = (n.data('boxHeight') as number) ?? 80;
    const x = startX + col * colW + w / 2;
    const y = cursorY + h / 2;
    n.position({ x, y });
    rowH = Math.max(rowH, h);
    col += 1;
    if (col >= cols) {
      col = 0;
      cursorY += rowH + NODE_SEP;
      rowH = 0;
    }
  });
}
