import { describe, it, expect } from 'vitest';
import { closedNeighborhood } from './closedNeighborhood';
import { nodeId } from '../buildGraph';
import type { ForeignKey } from '../../parser/types';

function fk(from: string, to: string): ForeignKey {
  return {
    fromTable: from,
    fromColumns: [`${from}_id`],
    toTable: to,
    toColumns: ['id'],
    source: 'explicit',
  };
}

describe('closedNeighborhood', () => {
  it('returns the seed itself when no FKs touch it', () => {
    const seed = new Set([nodeId('users')]);
    const hood = closedNeighborhood(seed, []);
    expect(hood).toEqual(seed);
  });

  it('includes both endpoints of any FK touching the seed', () => {
    const seed = new Set([nodeId('orders')]);
    const fks: ForeignKey[] = [fk('orders', 'users'), fk('order_items', 'orders')];
    const hood = closedNeighborhood(seed, fks);
    expect(hood).toContain(nodeId('orders'));
    expect(hood).toContain(nodeId('users'));
    expect(hood).toContain(nodeId('order_items'));
  });

  it('does not chain — only 1-hop neighbors are returned', () => {
    const seed = new Set([nodeId('users')]);
    const fks: ForeignKey[] = [fk('orders', 'users'), fk('order_items', 'orders')];
    const hood = closedNeighborhood(seed, fks);
    expect(hood).toContain(nodeId('users'));
    expect(hood).toContain(nodeId('orders'));
    // order_items is 2 hops away from users — must NOT be included.
    expect(hood).not.toContain(nodeId('order_items'));
  });
});
