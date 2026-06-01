import { describe, it, expect } from 'vitest';
import {
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
