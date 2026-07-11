import { describe, it, expect } from 'vitest';
import cytoscape from 'cytoscape';
import {
  arrangeForPublication,
  layoutEdgeWeight,
  collapseLayoutPairs,
  pairKey,
  type RawLayoutEdge,
} from './arrangeForPublication';

describe('layoutEdgeWeight', () => {
  it('ranks tiers explicit > accepted > high > medium > low', () => {
    const w = (m: Partial<Parameters<typeof layoutEdgeWeight>[0]>) =>
      layoutEdgeWeight({
        source: 'inferred',
        confidence: 'medium',
        accepted: false,
        sameModule: false,
        ...m,
      });
    const explicit = w({ source: 'explicit', confidence: 'high' });
    const accepted = w({ accepted: true });
    const high = w({ confidence: 'high' });
    const medium = w({ confidence: 'medium' });
    const low = w({ confidence: 'low' });
    expect(explicit).toBeGreaterThan(accepted);
    expect(accepted).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0); // pending edges still get a (tiny) weight
  });

  it('boosts same-module edges over cross-module', () => {
    const same = layoutEdgeWeight({
      source: 'inferred',
      confidence: 'high',
      accepted: false,
      sameModule: true,
    });
    const cross = layoutEdgeWeight({
      source: 'inferred',
      confidence: 'high',
      accepted: false,
      sameModule: false,
    });
    expect(same).toBeGreaterThan(cross);
  });

  it('keeps logical (business-key) links light regardless of source', () => {
    const w = (m: Partial<Parameters<typeof layoutEdgeWeight>[0]>) =>
      layoutEdgeWeight({
        source: 'inferred',
        kind: 'logical',
        confidence: 'medium',
        accepted: false,
        sameModule: false,
        ...m,
      });
    expect(w({ accepted: true })).toBe(2);
    expect(w({ accepted: false })).toBe(0.5);
    expect(w({ accepted: true, sameModule: true })).toBeCloseTo(3.6);
    // A MANUAL logical link must not weigh like a manual FK (16).
    expect(w({ source: 'manual', accepted: true })).toBe(2);
  });
});

describe('collapseLayoutPairs', () => {
  const e = (id: string, child: string, parent: string, weight = 1): RawLayoutEdge => ({
    id,
    child,
    parent,
    weight,
  });

  it('keys pairs in the reversed (parent -> child) layout direction', () => {
    // real FK: orders.user_id -> users  (child=orders, parent=users)
    const pairs = collapseLayoutPairs([e('e1', 'orders', 'users')]);
    const pair = pairs.get(pairKey('users', 'orders'));
    expect(pair).toBeDefined();
    expect(pair!.parent).toBe('users'); // referenced table ranks first (left)
    expect(pair!.child).toBe('orders');
  });

  it('collapses parallel child->parent FKs into one pair and sums weight', () => {
    // doc.created_by, doc.updated_by, doc.owner_id all -> users
    const pairs = collapseLayoutPairs([
      e('a', 'doc', 'users', 8),
      e('b', 'doc', 'users', 1),
      e('c', 'doc', 'users', 0.4),
    ]);
    expect(pairs.size).toBe(1);
    const pair = pairs.get(pairKey('users', 'doc'))!;
    expect(pair.members).toEqual(['a', 'b', 'c']);
    expect(pair.weight).toBeCloseTo(9.4);
  });

  it('keeps opposite-direction edges as distinct pairs', () => {
    const pairs = collapseLayoutPairs([e('a', 'x', 'y'), e('b', 'y', 'x')]);
    expect(pairs.size).toBe(2);
    expect(pairs.has(pairKey('y', 'x'))).toBe(true);
    expect(pairs.has(pairKey('x', 'y'))).toBe(true);
  });

  it('drops self-loops (dagre cannot rank them)', () => {
    const pairs = collapseLayoutPairs([
      e('self', 'comment', 'comment'),
      e('ok', 'comment', 'post'),
    ]);
    expect(pairs.size).toBe(1);
    expect(pairs.has(pairKey('post', 'comment'))).toBe(true);
  });
});

describe('arrangeForPublication / isolated tables', () => {
  const node = (id: string) => ({
    group: 'nodes' as const,
    data: { id, type: 'table', rawName: id, boxWidth: 240, boxHeight: 460 },
  });

  it('does not stack isolated tables into a giant vertical gap', () => {
    // 1 small connected pair + 28 isolated tables — the excashier.sql shape.
    // Before the fix, dagre stacked all 30 nodes into a ~14000px rank-0 column,
    // leaving a huge empty vertical gap the camera centered on (blank canvas).
    const cy = cytoscape({ headless: true });
    const els: cytoscape.ElementDefinition[] = [node('a'), node('b')];
    els.push({ group: 'edges', data: { id: 'e0', source: 'a', target: 'b' } });
    for (let i = 0; i < 28; i++) els.push(node(`iso_${i}`));
    cy.add(els);

    arrangeForPublication(cy);

    const ys = cy.nodes('[type = "table"]').map((n) => n.position().y);
    ys.sort((p, q) => p - q);
    const height = ys[ys.length - 1] - ys[0];
    // A compact grid of ~30 tall cards is a few thousand px, nowhere near the
    // ~19600px pathological stack.
    expect(height).toBeLessThan(8000);
    // No single empty vertical gap wider than a couple of card-heights.
    let maxGap = 0;
    for (let i = 1; i < ys.length; i++) maxGap = Math.max(maxGap, ys[i] - ys[i - 1]);
    expect(maxGap).toBeLessThan(2000);
  });
});
