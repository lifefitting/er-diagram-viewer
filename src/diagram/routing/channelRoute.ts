/**
 * Pure routing helpers for the publication (layered) print mode.
 *
 * The layered layout (dagre) gives each edge a centerline of waypoints that
 * thread through the node-free channels between ranks (dagre reserves slots via
 * dummy nodes, so this skeleton never crosses a card). We turn that skeleton
 * into a clean orthogonal H/V polyline docked at the field-row ports, then
 * encode it for cytoscape's `segments` curve-style.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Axis-aligned card rectangle (model coords). */
export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const EPS = 0.5;

/**
 * Does the segment p->q cross the interior of rect `r`? Liang-Barsky slab clip.
 * A segment that only grazes an edge (or merely touches a corner) does not
 * count — we require it to enter the interior — so an edge docking exactly on a
 * card boundary isn't treated as crossing it.
 */
export function segIntersectsRect(p: Pt, q: Pt, r: Rect): boolean {
  if (r.x2 <= r.x1 || r.y2 <= r.y1) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const clip = (pp: number, qq: number): boolean => {
    if (pp === 0) return qq > 0; // parallel: inside the slab iff strictly within
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (
    clip(-dx, p.x - r.x1) &&
    clip(dx, r.x2 - p.x) &&
    clip(-dy, p.y - r.y1) &&
    clip(dy, r.y2 - p.y)
  ) {
    return t1 - t0 > EPS / 100; // strictly crosses the interior
  }
  return false;
}

/**
 * Collect the obstacle rectangles for an edge: every card rect EXCEPT the
 * edge's own two endpoint cards (the route docks to those, so they must not
 * count as obstacles). Kept pure + exported so the "exclude exactly the two
 * endpoints" contract that `directOrthogonalRoute` relies on is unit-testable.
 */
export function buildObstacles(
  rects: Map<string, Rect>,
  excludeA: string,
  excludeB: string,
): Rect[] {
  const out: Rect[] = [];
  rects.forEach((r, id) => {
    if (id !== excludeA && id !== excludeB) out.push(r);
  });
  return out;
}

/**
 * Try to connect two field-row ports with the minimal-bend orthogonal route
 * that clears every obstacle card:
 *   - a straight segment when the ports already share a y (0 bends), or
 *   - an H-V-H with one vertical leg parked in the gutter between the cards
 *     (2 bends), sweeping a few candidate x positions for one whose three legs
 *     all miss every obstacle.
 * Returns null when no such clean route exists (caller then falls back to
 * dagre's channel waypoints). `obstacles` must EXCLUDE the two endpoint cards.
 */
export function directOrthogonalRoute(src: Pt, tgt: Pt, obstacles: Rect[]): Pt[] | null {
  const clearOf = (a: Pt, b: Pt) => !obstacles.some((r) => segIntersectsRect(a, b, r));

  if (Math.abs(src.y - tgt.y) < EPS) {
    return clearOf(src, tgt) ? [src, tgt] : null;
  }

  const loX = Math.min(src.x, tgt.x);
  const hiX = Math.max(src.x, tgt.x);
  if (hiX - loX < 2) return null; // no gutter to park the vertical in

  // Bias toward the middle of the gutter, then fan outward. A dense sweep keeps
  // us on the (obstacle-checked) 2-bend route rather than dropping to the
  // fallback when a card occupies part of the gutter.
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9];
  for (const f of fractions) {
    const vx = loX + (hiX - loX) * f;
    const a = { x: vx, y: src.y };
    const b = { x: vx, y: tgt.y };
    if (clearOf(src, a) && clearOf(a, b) && clearOf(b, tgt)) {
      return mergeCollinear([src, a, b, tgt]);
    }
  }
  return null;
}

/** Keep-out margin around each obstacle card for the detour router. */
const DETOUR_MARGIN = 18;
/** Cost (px) added per right-angle turn so the search prefers straighter paths. */
const BEND_PENALTY = 30;
/** Keep-out margin around the edge's OWN endpoint cards (when provided): a
 *  detour leg must never run flush along an endpoint card's border, or the
 *  connector becomes indistinguishable from the card outline and the field it
 *  docks to is unreadable. Smaller than PORT_STUB so the stub tip stays
 *  outside its own card's keep-out. */
const ENDPOINT_MARGIN = 10;
/** Length of the horizontal stub the route must keep at each port before it
 *  may turn — the visual anchor tying the connector to its field row. */
const PORT_STUB = 18;

function inflateRect(r: Rect, m: number): Rect {
  return { x1: r.x1 - m, y1: r.y1 - m, x2: r.x2 + m, y2: r.y2 + m };
}

function pointInsideRect(p: Pt, r: Rect): boolean {
  return p.x > r.x1 + EPS && p.x < r.x2 - EPS && p.y > r.y1 + EPS && p.y < r.y2 - EPS;
}

/** Optional endpoint-card context for {@link detourRoute}: with it, the route
 *  keeps a horizontal PORT_STUB at each port and treats the endpoint cards
 *  themselves as keep-outs (minus the stub), so no leg can hug a card border. */
export interface DetourEndpoints {
  srcRect?: Rect;
  tgtRect?: Rect;
  /** Horizontal exit direction at each port: +1 = leaves to the right. */
  srcDir?: 1 | -1;
  tgtDir?: 1 | -1;
}

/**
 * Obstacle-avoiding orthogonal router used when `directOrthogonalRoute` can't
 * find a clean 2-bend path (a card sits across the gutter — the classic
 * multi-rank case, or a card dragged into the channel). It is a tiny orthogonal
 * visibility graph over the CORNERS of the (inflated) obstacle rectangles plus
 * the two ports, so it produces a clean, node-following polyline at the CURRENT
 * positions — unlike the frozen dagre channel waypoints, which is what made
 * dragging look janky.
 *
 * Vertices = src, tgt, and the four corners of each keep-out rect near the
 * src→tgt box. Two vertices connect via a straight axis-aligned segment (0
 * bends) or an L through one corner (1 bend) when both legs clear every keep-out
 * rect. Dijkstra (tiny graph) with a stable tie-break finds the lowest-cost
 * path; cost = Manhattan length + a per-bend penalty so it prefers fewer turns.
 *
 * When `endpoints` provides the edge's own card rects + exit directions, the
 * search runs between STUB TIPS (port ± PORT_STUB) with the endpoint cards
 * added as keep-outs (inflated by ENDPOINT_MARGIN < PORT_STUB, so each tip
 * stays reachable). Without it, a detour's first move may legally be a
 * vertical drop AT the port — i.e. flush along the card's own border (the
 * endpoint cards are excluded from `obstacles`), which reads as part of the
 * card outline and hides which field the edge leaves from.
 *
 * Returns `[src, ...bends, tgt]` (src/tgt kept as first/last so the
 * routePoints/SVG port-docking contract holds) or null when fully boxed in.
 * `obstacles` must EXCLUDE the two endpoint cards (use `buildObstacles`).
 */
export function detourRoute(
  src: Pt,
  tgt: Pt,
  obstacles: Rect[],
  endpoints?: DetourEndpoints,
): Pt[] | null {
  // Endpoint-aware mode: route between the stub tips with the endpoint cards
  // as keep-outs. If a tip lands inside some keep-out (cards overlapping the
  // stub zone), fall back to the plain port-to-port search — a slightly uglier
  // route beats no route.
  if (endpoints && (endpoints.srcRect || endpoints.tgtRect)) {
    const { srcRect, tgtRect, srcDir = 1, tgtDir = -1 } = endpoints;
    const s0 = srcRect ? { x: src.x + srcDir * PORT_STUB, y: src.y } : src;
    const t0 = tgtRect ? { x: tgt.x + tgtDir * PORT_STUB, y: tgt.y } : tgt;
    const extra: Rect[] = [];
    if (srcRect) extra.push(inflateRect(srcRect, ENDPOINT_MARGIN));
    if (tgtRect) extra.push(inflateRect(tgtRect, ENDPOINT_MARGIN));
    const blockedTip = [...obstacles.map((r) => inflateRect(r, DETOUR_MARGIN)), ...extra].some(
      (r) => pointInsideRect(s0, r) || pointInsideRect(t0, r),
    );
    if (!blockedTip) {
      const inner = detourCore(s0, t0, obstacles, extra);
      if (inner) return mergeCollinear([src, ...inner, tgt]);
    }
    // fall through to the plain search
  }
  return detourCore(src, tgt, obstacles, []);
}

function detourCore(src: Pt, tgt: Pt, obstacles: Rect[], extraKeepOut: Rect[]): Pt[] | null {
  // Only obstacles near the src→tgt box can shape a sensible detour; pruning to
  // them keeps the vertex set (and the work) small regardless of schema size.
  const pad = DETOUR_MARGIN * 2;
  const bx1 = Math.min(src.x, tgt.x) - pad;
  const bx2 = Math.max(src.x, tgt.x) + pad;
  const by1 = Math.min(src.y, tgt.y) - pad;
  const by2 = Math.max(src.y, tgt.y) + pad;
  const keepOut = [
    ...obstacles
      .map((r) => inflateRect(r, DETOUR_MARGIN))
      .filter((r) => r.x2 >= bx1 && r.x1 <= bx2 && r.y2 >= by1 && r.y1 <= by2),
    // Endpoint-card keep-outs are pre-inflated (ENDPOINT_MARGIN) and always
    // relevant — never distance-pruned.
    ...extraKeepOut,
  ];

  // Routing vertices: ports + obstacle corners, dropping any corner buried
  // inside another keep-out rect (it can never be a usable waypoint).
  const verts: Pt[] = [src, tgt];
  for (const r of keepOut) {
    const corners: Pt[] = [
      { x: r.x1, y: r.y1 },
      { x: r.x2, y: r.y1 },
      { x: r.x1, y: r.y2 },
      { x: r.x2, y: r.y2 },
    ];
    for (const c of corners) {
      if (!keepOut.some((o) => pointInsideRect(c, o))) verts.push(c);
    }
  }
  // Deterministic vertex order → Dijkstra tie-breaks are stable frame-to-frame
  // (no micro-flicker as a card slides past a corner threshold).
  verts.sort((a, b) => a.x - b.x || a.y - b.y);
  const SRC = verts.indexOf(src);
  const TGT = verts.indexOf(tgt);

  const clear = (a: Pt, b: Pt) => !keepOut.some((r) => segIntersectsRect(a, b, r));
  const connect = (a: Pt, b: Pt): { corner: Pt | null; cost: number } | null => {
    const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS) {
      return clear(a, b) ? { corner: null, cost: manhattan } : null;
    }
    const c1 = { x: a.x, y: b.y };
    if (clear(a, c1) && clear(c1, b)) return { corner: c1, cost: manhattan + BEND_PENALTY };
    const c2 = { x: b.x, y: a.y };
    if (clear(a, c2) && clear(c2, b)) return { corner: c2, cost: manhattan + BEND_PENALTY };
    return null;
  };

  const N = verts.length;
  const dist = new Array<number>(N).fill(Infinity);
  const prev = new Array<number>(N).fill(-1);
  const prevCorner = new Array<Pt | null>(N).fill(null);
  const done = new Array<boolean>(N).fill(false);
  dist[SRC] = 0;
  for (let it = 0; it < N; it++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === TGT) break;
    done[u] = true;
    for (let v = 0; v < N; v++) {
      if (done[v] || v === u) continue;
      const conn = connect(verts[u], verts[v]);
      if (!conn) continue;
      const nd = dist[u] + conn.cost;
      // Strict improvement only → equal-cost ties keep the earlier (lower-index,
      // i.e. lexicographically smaller) path, reinforcing determinism.
      if (nd < dist[v] - EPS) {
        dist[v] = nd;
        prev[v] = u;
        prevCorner[v] = conn.corner;
      }
    }
  }
  if (!Number.isFinite(dist[TGT])) return null;

  const chain: number[] = [];
  for (let c = TGT; c !== -1; c = prev[c]) chain.push(c);
  chain.reverse();
  const poly: Pt[] = [verts[chain[0]]];
  for (let k = 1; k < chain.length; k++) {
    const corner = prevCorner[chain[k]];
    if (corner) poly.push(corner);
    poly.push(verts[chain[k]]);
  }
  return mergeCollinear(poly);
}

/** Horizontal extent of a card (model coords). */
export interface SpanX {
  left: number;
  right: number;
}

/**
 * Route two vertically-stacked cards (no usable horizontal gutter between them)
 * with a 2-bend SIDE bracket: both ports leave the SAME side (left or right),
 * the connector runs up/down in the side margin, and comes back in — instead of
 * a near-vertical line squeezed between (or threading down through) the cards.
 *
 * Tries the left margin first, then the right, returning the first whose three
 * legs all clear `obstacles` (which must exclude the two endpoint cards). `srcY`
 * / `tgtY` are the absolute field-row port Ys; the port X is taken from the
 * chosen side of each card. Returns null when neither side is clear.
 */
export function sideBracketRoute(
  srcY: number,
  tgtY: number,
  srcSpan: SpanX,
  tgtSpan: SpanX,
  margin: number,
  obstacles: Rect[],
): { points: Pt[]; side: 'left' | 'right' } | null {
  const clearOf = (a: Pt, b: Pt) => !obstacles.some((r) => segIntersectsRect(a, b, r));
  const build = (side: 'left' | 'right'): Pt[] => {
    const sx = side === 'left' ? srcSpan.left : srcSpan.right;
    const tx = side === 'left' ? tgtSpan.left : tgtSpan.right;
    const mx =
      side === 'left'
        ? Math.min(srcSpan.left, tgtSpan.left) - margin
        : Math.max(srcSpan.right, tgtSpan.right) + margin;
    return [
      { x: sx, y: srcY },
      { x: mx, y: srcY },
      { x: mx, y: tgtY },
      { x: tx, y: tgtY },
    ];
  };
  for (const side of ['left', 'right'] as const) {
    const p = build(side);
    if (clearOf(p[0], p[1]) && clearOf(p[1], p[2]) && clearOf(p[2], p[3])) {
      return { points: mergeCollinear(p), side };
    }
  }
  return null;
}

/**
 * Turn an arbitrary polyline into an axis-aligned (orthogonal) one. For each
 * input segment A→B that is neither horizontal nor vertical, insert an H-V-H
 * jog whose vertical leg sits at the segment's midpoint x. Because consecutive
 * dagre waypoints lie one rank apart, that midpoint falls in the node-free
 * gutter between ranks — so the orthogonal path stays out of every card.
 * Collinear/duplicate points are merged.
 */
export function orthogonalize(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const aligned = Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
    if (aligned) {
      out.push(b);
    } else {
      const midX = (a.x + b.x) / 2;
      out.push({ x: midX, y: a.y });
      out.push({ x: midX, y: b.y });
      out.push(b);
    }
  }
  return mergeCollinear(out);
}

/** Drop the middle of any three consecutive collinear points, and exact dupes. */
export function mergeCollinear(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue; // dupe
    out.push(p);
  }
  let i = 1;
  while (i < out.length - 1) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const collinearX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
    const collinearY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
    if (collinearX || collinearY) {
      out.splice(i, 1);
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Encode an absolute polyline as cytoscape `segments` weights/distances. Bends
 * are placed at: `bend = S + w·(T−S) + d·perp`, where `perp = (−dy, dx)/L`.
 * `points` includes the source (first) and target (last) endpoints; only the
 * interior points become bends.
 */
export function segmentsFromPoints(points: Pt[]): { weights: string; distances: string } {
  if (points.length <= 2) return { weights: '0.5', distances: '0' };
  const S = points[0];
  const T = points[points.length - 1];
  const dx = T.x - S.x;
  const dy = T.y - S.y;
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) return { weights: '0.5', distances: '0' };
  const L = Math.sqrt(L2);
  const weights: number[] = [];
  const distances: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const ox = points[i].x - S.x;
    const oy = points[i].y - S.y;
    const w = (ox * dx + oy * dy) / L2; // fraction along S→T
    const d = (ox * -dy + oy * dx) / L; // signed perpendicular distance
    weights.push(w);
    distances.push(d);
  }
  return {
    weights: weights.map((w) => w.toFixed(4)).join(' '),
    distances: distances.map((d) => d.toFixed(2)).join(' '),
  };
}

// ---- routePoints / endpoint string codec ----------------------------------
// The single source of truth for the `"x,y x,y …"` route encoding and the
// `"<x>px <y>px"` endpoint-offset encoding shared by the canvas, the routing
// pass and the SVG export. Keeping encode+parse together stops the formats from
// drifting (precision, separators, NaN handling) across the call sites.

/** Encode an absolute polyline as the `routePoints` string (1dp). */
export function pointsToRoute(pts: Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Parse a `routePoints` string back to points, skipping empty/non-finite tokens. */
export function routeToPoints(s: string | undefined | null): Pt[] {
  const out: Pt[] = [];
  for (const tok of (s ?? '').split(' ')) {
    if (!tok) continue;
    const [x, y] = tok.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

/** Encode a port endpoint offset as the cytoscape `"<x>px <y>px"` string (1dp). */
export function formatEndpoint(off: Pt): string {
  return `${off.x.toFixed(1)}px ${off.y.toFixed(1)}px`;
}

/** Parse a `"<x>px <y>px"` endpoint string; null for the `outside-to-node`
 *  placeholder or any malformed value (caller falls back gracefully). */
export function parseEndpoint(s: unknown): Pt | null {
  if (typeof s !== 'string') return null;
  const m = /^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px$/.exec(s.trim());
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/**
 * Shift one *interior* orthogonal segment of a route perpendicular to itself,
 * keeping the path H/V-only. The segment between `points[segIndex]` and
 * `points[segIndex+1]` must have BOTH endpoints be interior bends (never a
 * port): a horizontal segment moves vertically (both endpoints' y), a vertical
 * one moves horizontally (both x). The perpendicular neighbours just lengthen,
 * so the whole polyline stays orthogonal. Used by the drag-to-edit handles.
 */
export function dragSegment(points: Pt[], segIndex: number, dModel: Pt): Pt[] {
  if (segIndex < 1 || segIndex + 1 > points.length - 2) return points.slice();
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  const a = out[segIndex];
  const b = out[segIndex + 1];
  if (Math.abs(a.y - b.y) < EPS) {
    a.y += dModel.y;
    b.y += dModel.y;
  } else {
    a.x += dModel.x;
    b.x += dModel.x;
  }
  return mergeCollinear(out);
}

/**
 * Re-dock a stored manual route onto the CURRENT ports: keep the user's interior
 * bends but replace the (stale) endpoints with the live `src`/`tgt`, then
 * re-orthogonalise the whole polyline so a node nudge can't leave a diagonal
 * port leg. Returns null when the ports coincide (a degenerate route that
 * `segmentsFromPoints` would silently collapse).
 */
export function reDockOverride(interior: Pt[], src: Pt, tgt: Pt): Pt[] | null {
  if ((src.x - tgt.x) * (src.x - tgt.x) + (src.y - tgt.y) * (src.y - tgt.y) === 0) return null;
  return mergeCollinear(orthogonalize([src, ...interior, tgt]));
}
