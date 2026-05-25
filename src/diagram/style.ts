import type { StylesheetJson } from 'cytoscape';

/**
 * Edge styling notes:
 *  - `curve-style: segments` lets us hand-place the two bend points so every FK
 *    is a pure H-V-H three-segment orthogonal polyline. We previously used
 *    `curve-style: taxi` but it occasionally degraded to diagonals when the
 *    source/target boxes overlapped horizontally or when per-field endpoints
 *    ended up on the same side. With explicit `segment-weights` /
 *    `segment-distances` (computed in DiagramCanvas.updateEdgeEndpoints) the
 *    bends are deterministic and never diagonal.
 *  - Endpoints come from edge `data(srcEndpoint)` / `data(tgtEndpoint)`. These
 *    are computed by DiagramCanvas as `<x>px <y>px` strings relative to each
 *    node's center, so an FK lands at the exact column row of its source /
 *    target field rather than just somewhere on the card edge. Until the canvas
 *    has run its first endpoint-update pass the strings default to
 *    `outside-to-node`, which is a graceful fallback.
 */
export function buildStylesheet(): StylesheetJson {
  return [
    {
      selector: 'node[type = "table"]',
      style: {
        shape: 'round-rectangle',
        'background-color': '#ffffff',
        'background-opacity': 0,
        'border-width': 0,
        label: '',
        width: 'data(boxWidth)',
        height: 'data(boxHeight)',
      } as any,
    },
    {
      selector: 'node.dimmed',
      style: { opacity: 0.25 },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'segments',
        // CRITICAL: by default cytoscape positions segment bends relative to the
        // node-boundary intersection of the source→target line, not our manual
        // endpoints. With per-field endpoints (offset off-center) that produces
        // diagonals. `edge-distances: endpoints` makes the (w, d) reference
        // line run from `source-endpoint` to `target-endpoint`, so a weight of
        // 0.25 lands the bend exactly at midX between our two endpoints.
        'edge-distances': 'endpoints',
        'segment-weights': 'data(segWeights)',
        'segment-distances': 'data(segDistances)',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'data(color)',
        'line-color': 'data(color)',
        width: 1.6,
        opacity: 0.85,
        // Edges intentionally carry no label: column→column wording on every
        // line clutters the canvas and the same info is already available via
        // the hover tooltip (which reads from `meta`). Color + endpoint
        // alignment give enough visual cue about which columns connect.
        'source-endpoint': 'data(srcEndpoint)',
        'target-endpoint': 'data(tgtEndpoint)',
      } as any,
    },
    {
      selector: 'edge.same-module',
      style: {
        opacity: 0.6,
        width: 1.3,
      } as any,
    },
    // Line style is decision-driven, not confidence-driven:
    //   explicit FK or user-accepted inferred FK → solid
    //   inferred FK still pending decision         → dashed (any confidence)
    // Rejected inferred FKs are filtered out upstream and never reach the graph.
    {
      selector: 'edge[lineStyle = "dashed"]',
      style: { 'line-style': 'dashed' },
    },
    {
      selector: 'edge[confidence = "low"][lineStyle = "dashed"]',
      // Low-confidence pending edges keep a slightly fainter look so users
      // can still tell them apart at a glance, without changing the dash style.
      style: { opacity: 0.55 },
    },
    {
      selector: 'edge.highlight',
      style: { width: 3, opacity: 1, 'z-index': 10 },
    },
    {
      selector: 'edge.dimmed',
      style: { opacity: 0.08 },
    },
  ];
}

/** Back-compat default export. */
export const stylesheet: StylesheetJson = buildStylesheet();
