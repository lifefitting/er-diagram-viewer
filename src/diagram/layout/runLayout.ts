import type { Core } from 'cytoscape';
import { arrangeForPublication } from './arrangeForPublication';

/**
 * Publication-grade layered (LR) layout with orthogonal channel routing. dagre
 * ranks tables into columns whose wide gaps act as routing channels and
 * stashes per-edge channel waypoints; updateEdgeEndpoints (fired by the
 * `layoutstop` event below) docks them to field-row ports and orthogonalises,
 * so no connector crosses a card. The fit clamps zoom to ≥ 1 so the React
 * overlay text never blurs.
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
 * Fit to content, but never zoom OUT below 1.0 — at lower zoom the React
 * overlays shrink while their text (rendered at fixed CSS px) doesn't, so long
 * column/table names start truncating. The toolbar "适应屏幕" button (which
 * calls cy.fit directly with no clamp) is the explicit "see everything at
 * once" escape hatch.
 */
function fitWithZoomClamp(cy: Core) {
  cy.fit(undefined, 60);
  if (cy.zoom() < 1) {
    cy.zoom(1);
    cy.center();
  }
}
