import { describe, expect, it } from 'vitest';
import cytoscape, { type Core } from 'cytoscape';
import { parseSql } from '../../parser';
import type { Table } from '../../parser/types';
import type { DisplayOptions } from '../../store';
import { updateEdgeEndpoints } from './updateEdgeEndpoints';
import { routeToPoints, type Pt } from './channelRoute';
import { countCrossings, countOverlaps } from './routeMetrics';
import { nodeId } from '../nodeId';

/**
 * Integration guardrail for the routing post-passes: build a small headless
 * graph whose per-edge routes would all park their vertical in the SAME
 * gutter position (the pre-track-assignment behaviour), run the real
 * `updateEdgeEndpoints`, and assert the metrics.
 */

const DISPLAY: DisplayOptions = {
  onlyPk: false,
  showType: true,
  showComment: true,
  showIndex: true,
  showLowConfidence: false,
  showGrid: true,
  showLogicalLinks: true,
  showManualLinks: true,
};

function buildFixture(): { cy: Core; tableById: Map<string, Table> } {
  const schema = parseSql(`
    CREATE TABLE a (c0 INT, c1 INT, c2 INT);
    CREATE TABLE b (id INT);
    CREATE TABLE c (id INT);
    CREATE TABLE d (id INT);
  `);
  const tableById = new Map<string, Table>();
  for (const t of schema.tables) tableById.set(nodeId(t.name), t);

  const node = (name: string, x: number, y: number, h: number) => ({
    group: 'nodes' as const,
    data: { id: nodeId(name), type: 'table', rawName: name, boxWidth: 200, boxHeight: h },
    position: { x, y },
  });
  const edge = (id: string, srcRow: number, target: string) => ({
    group: 'edges' as const,
    data: {
      id,
      fkKey: `k_${id}`,
      source: nodeId('a'),
      target: nodeId(target),
      srcRowIdx: srcRow,
      tgtRowIdx: 0,
    },
  });

  // `a` fans out to three cards stacked at the same x on the right, so every
  // direct route shares the [100, 300] gutter and would pick x=200 first.
  // NOTE: elements are added via cy.add(), not the constructor — headless
  // cytoscape silently drops `position` on constructor elements.
  const cy = cytoscape({ headless: true });
  cy.add([
    node('a', 0, 0, 100),
    node('b', 400, -250, 50),
    node('c', 400, 120, 50),
    node('d', 400, 300, 50),
    edge('e0', 0, 'b'),
    edge('e1', 1, 'c'),
    edge('e2', 2, 'd'),
  ]);
  return { cy, tableById };
}

const routesOf = (cy: Core): Pt[][] =>
  cy.edges().map((e) => routeToPoints(e.data('routePoints') as string));

describe('updateEdgeEndpoints post-passes', () => {
  it('routes a same-gutter fan with zero overlaps and zero crossings', () => {
    const { cy, tableById } = buildFixture();
    updateEdgeEndpoints(cy, cy.edges(), {}, tableById, DISPLAY);
    const routes = routesOf(cy);
    expect(routes).toHaveLength(3);
    for (const r of routes) expect(r.length).toBeGreaterThanOrEqual(2);
    expect(countOverlaps(routes)).toBe(0);
    expect(countCrossings(routes)).toBe(0);
  });

  it('keeps endpoint offsets consistent with the route endpoints', () => {
    const { cy, tableById } = buildFixture();
    updateEdgeEndpoints(cy, cy.edges(), {}, tableById, DISPLAY);
    cy.edges().forEach((e) => {
      const pts = routeToPoints(e.data('routePoints') as string);
      const src = e.source().position();
      const m = /^(-?[\d.]+)px\s+(-?[\d.]+)px$/.exec(e.data('srcEndpoint') as string)!;
      expect(src.x + parseFloat(m[1])).toBeCloseTo(pts[0].x, 0);
      expect(src.y + parseFloat(m[2])).toBeCloseTo(pts[0].y, 0);
    });
  });

  it('leaves manual-override routes untouched by the post-passes', () => {
    const { cy, tableById } = buildFixture();
    // Hand-edited route for e1 with its vertical parked at x=250.
    const manual: Record<string, Pt[]> = {
      k_e1: [
        { x: 100, y: 10 },
        { x: 250, y: 10 },
        { x: 250, y: 120 },
        { x: 300, y: 120 },
      ],
    };
    updateEdgeEndpoints(cy, cy.edges(), {}, tableById, DISPLAY, false, manual);
    const pts = routeToPoints(cy.getElementById('e1').data('routePoints') as string);
    // The user's interior bend x survives re-docking and track assignment.
    expect(pts.some((p) => Math.abs(p.x - 250) < 0.6)).toBe(true);
  });

  it('fans out two edges docked on the SAME source column', () => {
    const { cy, tableById } = buildFixture();
    // Both edges leave a.c0 — without the dock spread they'd depart as one line.
    cy.add({
      group: 'edges',
      data: {
        id: 'e3',
        fkKey: 'k_e3',
        source: nodeId('a'),
        target: nodeId('c'),
        srcRowIdx: 0,
        tgtRowIdx: 0,
      },
    });
    updateEdgeEndpoints(cy, cy.edges(), {}, tableById, DISPLAY);
    const y0 = routeToPoints(cy.getElementById('e0').data('routePoints') as string)[0].y;
    const y3 = routeToPoints(cy.getElementById('e3').data('routePoints') as string)[0].y;
    expect(Math.abs(y0 - y3)).toBeGreaterThanOrEqual(4);
    // The spread stays inside the field row (~21px tall).
    expect(Math.abs(y0 - y3)).toBeLessThanOrEqual(12);
    expect(countOverlaps(routesOf(cy))).toBe(0);
  });

  it('dodges routes outside a partial update batch instead of landing on them', () => {
    const { cy, tableById } = buildFixture();
    updateEdgeEndpoints(cy, cy.edges(), {}, tableById, DISPLAY);
    // Re-route ONLY e2 (the drag hot path shape); e0/e1 keep their stored routes.
    updateEdgeEndpoints(cy, cy.getElementById('e2') as never, {}, tableById, DISPLAY, true);
    expect(countOverlaps(routesOf(cy))).toBe(0);
  });
});
