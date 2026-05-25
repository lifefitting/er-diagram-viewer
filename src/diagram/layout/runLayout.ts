import type { Core, LayoutOptions } from 'cytoscape';
import { arrangeAroundHubs } from './arrangeAroundHubs';

export interface RunLayoutOptions {
  /**
   * When true, ignore the current node positions and let the algorithm pick
   * a fresh starting configuration. The "重置布局" button uses this to give
   * users a genuinely new arrangement (otherwise fcose would just iterate
   * around the existing local minimum).
   */
  randomize?: boolean;
}

/**
 * Run the requested layout (fcose / dagre), refine hub fan-in, then fit to
 * content with a `zoom >= 1` clamp so overlay text never blurs.
 *
 * Bigger cards (now up to 560px wide) need more breathing room than the
 * older 340px-capped layout used. Each parameter below is a trade-off:
 *   - nodeRepulsion / nodeSeparation push cards apart (less overlap),
 *   - idealEdgeLength keeps connected cards close enough to read FKs,
 *   - gravity stops disconnected components from drifting infinitely apart,
 *   - numIter trades cost for layout quality.
 * The values are tuned for graphs of ~10-50 tables; very large schemas may
 * still need manual nudging via drag.
 */
export function runLayout(cy: Core, layout: string, opts: RunLayoutOptions = {}) {
  const randomize = opts.randomize ?? true;
  const layoutOpts: LayoutOptions =
    layout === 'dagre'
      ? ({
          name: 'dagre',
          rankDir: 'LR',
          // nodeSep / rankSep are in pixels between bounding boxes, not
          // centers, so these are the actual gaps the user will see.
          nodeSep: 80,
          rankSep: 160,
          edgeSep: 30,
          ranker: 'tight-tree',
        } as unknown as LayoutOptions)
      : ({
          name: 'fcose',
          animate: false,
          quality: 'proof',
          // randomize=true on every reset gives a fresh starting point. If we
          // kept the current positions fcose would tend to settle back into
          // the same minimum and the user wouldn't see any change.
          randomize,
          // Roughly one card-width between bbox edges; with 560px cards this
          // keeps the closest pair ~700px center-to-center, plenty of room
          // for the H-V-H FK polylines to thread between them.
          nodeSeparation: 220,
          idealEdgeLength: 240,
          // Lower gravity = components spread out more, but we still pull
          // disconnected groups toward the center so the diagram doesn't
          // explode off-screen.
          gravity: 0.12,
          gravityRangeCompound: 1.5,
          gravityCompound: 1.0,
          nodeRepulsion: 14000,
          edgeElasticity: 0.4,
          numIter: 4000,
          uniformNodeDimensions: false,
          // Pack disconnected components side-by-side instead of letting them
          // overlap in the same canvas region.
          packComponents: true,
          tile: true,
          tilingPaddingHorizontal: 60,
          tilingPaddingVertical: 60,
          // fcose's "step: all" runs the full transform→draft→cose pipeline,
          // which costs more per click but produces the fewest edge crossings.
          step: 'all',
        } as unknown as LayoutOptions);
  cy.layout(layoutOpts).run();
  cy.scratch('_lastLayout', layout);
  // After the generic force/layered pass, refine "hub" tables: any table that
  // 3+ other tables point to gets its fan-in arranged in a ring around it.
  // Skipped on dagre since the layered layout already imposes its own
  // column ordering.
  if (layout !== 'dagre') {
    arrangeAroundHubs(cy);
  }
  // Fit to content, but never zoom OUT below 1.0 — at lower zoom the React
  // overlays shrink while their text (rendered at fixed CSS px) doesn't, so
  // long column/table names start truncating. Forcing zoom ≥ 1 keeps the
  // text always at its designed size; if the content is larger than the
  // viewport the user can pan freely. The toolbar "适应屏幕" button (which
  // calls cy.fit directly with no clamp) is the explicit "see everything at
  // once" escape hatch when readability isn't the priority.
  cy.fit(undefined, 60);
  if (cy.zoom() < 1) {
    cy.zoom(1);
    cy.center();
  }
}
