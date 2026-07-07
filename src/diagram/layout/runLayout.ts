import type { Core } from 'cytoscape';
import { arrangeForPublication } from './arrangeForPublication';

/**
 * Publication-grade layered (LR) layout with orthogonal channel routing. dagre
 * ranks tables into columns whose wide gaps act as routing channels and
 * stashes per-edge channel waypoints; updateEdgeEndpoints (fired by the
 * `layoutstop` event below) docks them to field-row ports and orthogonalises,
 * so no connector crosses a card. The fit frames the whole diagram (see
 * `fitWithZoomClamp`).
 */
export function runLayout(cy: Core) {
  arrangeForPublication(cy);
  // arrangeForPublication writes node positions directly rather than running a
  // cy.layout(), so cytoscape doesn't fire `layoutstop` on its own. Emit it
  // ourselves so the canvas's endpoint-refresh handler still runs.
  cy.emit('layoutstop');
  fitWithZoomClamp(cy);
}

/**
 * Lower bound for the initial auto-fit zoom. Below ~1.0 the fixed-CSS-px
 * overlay text shrinks relative to its card and long names start truncating,
 * so we'd LIKE to stay at 1.0 — but a schema larger than the viewport can't be
 * framed at 1.0 (only a central slice shows, and for a sparse layout that slice
 * can be empty → blank canvas on import). Framing the whole diagram wins:
 * floor at a low value so big schemas fit as a legible-enough overview the user
 * can then zoom into, while still avoiding an absurd sub-pixel zoom-out.
 */
const MIN_FIT_ZOOM = 0.2;

/**
 * Fit the whole diagram into view. `cy.fit` frames + centers on the content;
 * we only clamp the zoom to `MIN_FIT_ZOOM` so it never goes microscopic (and
 * re-center after clamping, since the clamp changes the framing). The toolbar
 * "全览" button calls `cy.fit` directly with no clamp for a true fit-to-all.
 */
function fitWithZoomClamp(cy: Core) {
  cy.fit(undefined, 60);
  if (cy.zoom() < MIN_FIT_ZOOM) {
    cy.zoom(MIN_FIT_ZOOM);
    cy.center();
  }
}
