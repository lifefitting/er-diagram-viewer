import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { reconcileElements } from './reconcileElements';

describe('reconcileElements', () => {
  it('preserves positions, route runtime data and interaction classes by stable id', () => {
    const cy = cytoscape({ headless: true });
    reconcileElements(cy, [
      { group: 'nodes', data: { id: 'a', label: 'A' } },
      { group: 'nodes', data: { id: 'b', label: 'B' } },
      { group: 'edges', data: { id: 'ab', source: 'a', target: 'b', color: 'red' } },
    ]);
    cy.getElementById('a').position({ x: 120, y: 80 }).addClass('highlight');
    cy.getElementById('ab').data('routePoints', '0,0 10,10').addClass('manual-selected');

    const result = reconcileElements(cy, [
      { group: 'nodes', data: { id: 'a', label: 'A2' } },
      { group: 'nodes', data: { id: 'b', label: 'B' } },
      { group: 'nodes', data: { id: 'c', label: 'C' } },
      { group: 'edges', data: { id: 'ab', source: 'a', target: 'b', color: 'blue' } },
    ]);

    expect(result.addedNodeIds).toEqual(new Set(['c']));
    expect(cy.getElementById('a').position()).toEqual({ x: 120, y: 80 });
    expect(cy.getElementById('a').data('label')).toBe('A2');
    expect(cy.getElementById('a').hasClass('highlight')).toBe(true);
    expect(cy.getElementById('ab').data('routePoints')).toBe('0,0 10,10');
    expect(cy.getElementById('ab').hasClass('manual-selected')).toBe(true);
    cy.destroy();
  });

  it('removes stale elements and supports explicit fresh replacement', () => {
    const cy = cytoscape({ headless: true, elements: [{ data: { id: 'old' } }] });
    const result = reconcileElements(cy, [{ group: 'nodes', data: { id: 'new' } }], true);
    expect(result.removedNodeIds).toEqual(new Set(['old']));
    expect(result.addedNodeIds).toEqual(new Set(['new']));
    expect(cy.getElementById('old').empty()).toBe(true);
    cy.destroy();
  });
});
