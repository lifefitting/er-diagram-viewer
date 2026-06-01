import type { Core, EdgeCollection } from 'cytoscape';
import type { Table } from '../../parser/types';
import type { DisplayOptions } from '../../store';
import { columnRowOffsets } from '../buildGraph';
import { computeEndpointOffset } from './computeEndpointOffset';
import {
  orthogonalize,
  segmentsFromPoints,
  directOrthogonalRoute,
  detourRoute,
  reDockOverride,
  sideBracketRoute,
  buildObstacles,
  formatEndpoint,
  pointsToRoute,
  type Pt,
  type Rect,
} from './channelRoute';

/** Minimum vertical port offset for the stacked/bracket treatment to apply. */
const VERTICAL_OFFSET = 24;
/** How far the bracket's vertical leg sits outside the cards' shared side. */
const SIDE_MARGIN = 30;

/**
 * Recompute and write per-field endpoints + segment bends for a collection of
 * edges. Uses `cy.batch` so cytoscape only does one render pass per call even
 * when many edges are touched.
 *
 * Every edge produces an absolute orthogonal polyline (`routePoints`) that
 * drives both the canvas (`segments` curve-style) and the SVG export, so the
 * two stay pixel-aligned:
 *   - regular edges: dock the source/target ports to dagre's channel
 *     waypoints (`dagreWaypoints`, set by arrangeForPublication) and
 *     orthogonalise. With no waypoints (initial render before layout) the
 *     orthogonalise step degenerates to a single H-V-H midpoint jog.
 *   - self-loops: dagre can't rank them, so route a U-shape on the card's
 *     right side — both endpoints exit right, the path loops out at `outerX`
 *     and comes back in, never re-entering the card body.
 */
/**
 * `liveRoute` selects the fallback used when no clean 2-bend direct route
 * exists: the static (layout/export) pass keeps dagre's channel waypoints, but
 * an interactive pass (after the user has manually moved a card) routes a fresh
 * obstacle-avoiding detour from the CURRENT ports instead — dagre's absolute
 * waypoints would otherwise stay frozen at their layout-time positions and make
 * the dragged connector look kinked. See DiagramCanvas `manualMoveRef`.
 */
export function updateEdgeEndpoints(
  cy: Core,
  edges: EdgeCollection,
  collapsed: Record<string, boolean>,
  tableById: Map<string, Table>,
  display: DisplayOptions,
  liveRoute = false,
  manualRoutes: Record<string, Pt[]> = {},
): void {
  if (edges.length === 0) return;
  // Memoize per-table row offsets — many edges share endpoints on the same node.
  const offsetsCache = new Map<string, number[]>();
  const rowOffsets = (table: Table | undefined): number[] => {
    if (!table) return [];
    const cached = offsetsCache.get(table.name);
    if (cached) return cached;
    const arr = columnRowOffsets(table, {
      showComment: display.showComment,
      showType: display.showType,
      onlyPk: display.onlyPk,
    });
    offsetsCache.set(table.name, arr);
    return arr;
  };
  // Card rectangles for obstacle-aware direct routing. Built once; the endpoint
  // cards are excluded per-edge below. A 1px inset keeps an edge that docks
  // exactly on a neighbour's boundary from registering as a crossing.
  const INSET = 1;
  const rectById = new Map<string, Rect>();
  cy.nodes('[type = "table"]').forEach((n) => {
    const p = n.position();
    // Defaults match arrangeForPublication so a node with momentarily-missing
    // size data still acts as a real obstacle (not a zero-area phantom).
    const w = (n.data('boxWidth') as number) ?? 240;
    const h = (n.data('boxHeight') as number) ?? 80;
    rectById.set(n.id(), {
      x1: p.x - w / 2 + INSET,
      y1: p.y - h / 2 + INSET,
      x2: p.x + w / 2 - INSET,
      y2: p.y + h / 2 - INSET,
    });
  });

  cy.batch(() => {
    edges.forEach((e) => {
      const src = e.source();
      const tgt = e.target();
      const srcName = (src.data('rawName') as string) ?? '';
      const tgtName = (tgt.data('rawName') as string) ?? '';
      const srcRowIdx = (e.data('srcRowIdx') as number | undefined) ?? -1;
      const tgtRowIdx = (e.data('tgtRowIdx') as number | undefined) ?? -1;
      const srcCollapsed = !!collapsed[srcName];
      const tgtCollapsed = !!collapsed[tgtName];
      const srcW = (src.data('boxWidth') as number) ?? 0;
      const srcH = (src.data('boxHeight') as number) ?? 0;
      const tgtW = (tgt.data('boxWidth') as number) ?? 0;
      const tgtH = (tgt.data('boxHeight') as number) ?? 0;
      const srcTable = tableById.get(src.id());
      const tgtTable = tableById.get(tgt.id());
      const srcOffs = rowOffsets(srcTable);
      const tgtOffs = rowOffsets(tgtTable);
      // A `NaN` offset means the column is hidden (onlyPk mode) — treat it like a
      // missing row so the port docks to the card center, not a phantom Y.
      const offAt = (offs: number[], idx: number): number | null => {
        const v = idx >= 0 && idx < offs.length ? offs[idx] : NaN;
        return Number.isFinite(v) ? v : null;
      };
      const srcY = offAt(srcOffs, srcRowIdx);
      const tgtY = offAt(tgtOffs, tgtRowIdx);
      const srcPos = src.position();
      const tgtPos = tgt.position();

      let pts: Pt[];
      let srcOff: { x: number; y: number };
      let tgtOff: { x: number; y: number };

      if (src.id() === tgt.id()) {
        // Self-loop: both endpoints on the right, U-shape out and back.
        srcOff = computeEndpointOffset(srcY, srcCollapsed, srcW, srcH, 'right');
        tgtOff = computeEndpointOffset(tgtY, tgtCollapsed, tgtW, tgtH, 'right');
        const sx = srcPos.x + srcOff.x;
        const sy = srcPos.y + srcOff.y;
        const tx = tgtPos.x + tgtOff.x;
        const ty = tgtPos.y + tgtOff.y;
        const outerX = Math.max(sx, tx) + 36;
        pts = [
          { x: sx, y: sy },
          { x: outerX, y: sy },
          { x: outerX, y: ty },
          { x: tx, y: ty },
        ];
      } else {
        const obstacles = buildObstacles(rectById, src.id(), tgt.id());
        // Field-row port Y is the same whichever side we dock to.
        const sy = srcPos.y + computeEndpointOffset(srcY, srcCollapsed, srcW, srcH, 'left').y;
        const ty = tgtPos.y + computeEndpointOffset(tgtY, tgtCollapsed, tgtW, tgtH, 'left').y;
        const srcSpan = { left: srcPos.x - srcW / 2, right: srcPos.x + srcW / 2 };
        const tgtSpan = { left: tgtPos.x - tgtW / 2, right: tgtPos.x + tgtW / 2 };
        // Horizontal gap between the two cards (negative if their x-ranges overlap).
        const gapX = Math.max(tgtSpan.left - srcSpan.right, srcSpan.left - tgtSpan.right);

        // 0) Manual override (a drag-edited route): re-dock the user's interior
        // bends onto the CURRENT ports, skipping the auto-route cascade. The port
        // side is derived from the stored route's own endpoints so a bracket- or
        // direct-shaped edit both re-dock correctly. Reconciliation (clearing the
        // override when a connected node is moved) happens in DiagramCanvas, NOT
        // here — this branch only reads.
        const override = manualRoutes[e.data('fkKey') as string];
        let overridePts: Pt[] | null = null;
        let overrideSrcOff: { x: number; y: number } | null = null;
        let overrideTgtOff: { x: number; y: number } | null = null;
        if (override && override.length >= 2) {
          const last = override[override.length - 1];
          const sSide: 'left' | 'right' =
            Math.abs(override[0].x - srcSpan.left) <= Math.abs(override[0].x - srcSpan.right)
              ? 'left'
              : 'right';
          const tSide: 'left' | 'right' =
            Math.abs(last.x - tgtSpan.left) <= Math.abs(last.x - tgtSpan.right) ? 'left' : 'right';
          const so = computeEndpointOffset(srcY, srcCollapsed, srcW, srcH, sSide);
          const to = computeEndpointOffset(tgtY, tgtCollapsed, tgtW, tgtH, tSide);
          const redocked = reDockOverride(
            override.slice(1, -1),
            { x: srcPos.x + so.x, y: sy },
            { x: tgtPos.x + to.x, y: ty },
          );
          if (redocked) {
            overridePts = redocked;
            overrideSrcOff = so;
            overrideTgtOff = to;
          }
        }

        if (overridePts && overrideSrcOff && overrideTgtOff) {
          pts = overridePts;
          srcOff = overrideSrcOff;
          tgtOff = overrideTgtOff;
        } else {
          let routed: Pt[] | null = null;
          let srcSide: 'left' | 'right';
          let tgtSide: 'left' | 'right';

          // Vertically-stacked: the cards' x-ranges OVERLAP (gapX < 0) so there's
          // no horizontal gutter between them — route a same-side 2-bend bracket
          // out through the side margin. Side-by-side cards (gapX >= 0, even a
          // small gap) fall through to the direct route instead; a bracket there
          // would have to draw the far card's leg back across the near card (which
          // is excluded from `obstacles`, so the crossing wouldn't be caught).
          if (gapX < 0 && Math.abs(sy - ty) > VERTICAL_OFFSET) {
            const bracket = sideBracketRoute(sy, ty, srcSpan, tgtSpan, SIDE_MARGIN, obstacles);
            if (bracket) {
              routed = bracket.points;
              srcSide = bracket.side;
              tgtSide = bracket.side;
            }
          }

          if (routed) {
            srcOff = computeEndpointOffset(srcY, srcCollapsed, srcW, srcH, srcSide!);
            tgtOff = computeEndpointOffset(tgtY, tgtCollapsed, tgtW, tgtH, tgtSide!);
            pts = routed;
          } else {
            // Horizontal relationship: exit toward the peer, then prefer the
            // minimal-bend direct route (2 bends) when it clears every other card;
            // only fall back to dagre's channel waypoints when a card blocks it.
            const dxNode = tgtPos.x - srcPos.x;
            srcSide = dxNode >= 0 ? 'right' : 'left';
            tgtSide = dxNode >= 0 ? 'left' : 'right';
            srcOff = computeEndpointOffset(srcY, srcCollapsed, srcW, srcH, srcSide);
            tgtOff = computeEndpointOffset(tgtY, tgtCollapsed, tgtW, tgtH, tgtSide);
            const sx = srcPos.x + srcOff.x;
            const tx = tgtPos.x + tgtOff.x;
            const direct = directOrthogonalRoute({ x: sx, y: sy }, { x: tx, y: ty }, obstacles);
            if (direct) {
              pts = direct;
            } else if (liveRoute) {
              // Interactive pass: route around the cards from the live ports so the
              // connector follows the dragged node. A live-midpoint H-V-H is the
              // last resort if even the detour is boxed in (still node-relative).
              const detour = detourRoute({ x: sx, y: sy }, { x: tx, y: ty }, obstacles);
              pts = detour ?? orthogonalize([{ x: sx, y: sy }, { x: tx, y: ty }]);
            } else {
              // Static (layout/export) pass: dock to dagre's channel waypoints.
              const waypoints = (e.data('dagreWaypoints') as Pt[] | undefined) ?? [];
              pts = orthogonalize([{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }]);
            }
          }
        }
      }

      const { weights, distances } = segmentsFromPoints(pts);
      e.data('srcEndpoint', formatEndpoint(srcOff));
      e.data('tgtEndpoint', formatEndpoint(tgtOff));
      e.data('segWeights', weights);
      e.data('segDistances', distances);
      e.data('routePoints', pointsToRoute(pts));
    });
  });
}
