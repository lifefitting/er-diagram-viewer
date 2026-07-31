import { describe, expect, it } from 'vitest';
import { placeIncrementalNodes } from './incrementalLayout';

describe('placeIncrementalNodes', () => {
  const fixed = [
    { id: 'users', x: 100, y: 100, width: 240, height: 120 },
    { id: 'orders', x: 480, y: 360, width: 300, height: 180 },
  ];

  it('places a related new table to the right and aligns it with its anchor', () => {
    const result = placeIncrementalNodes(fixed, [
      { id: 'payments', width: 260, height: 140, neighborIds: ['orders'] },
    ]);

    expect(result.payments.y).toBe(360);
    expect(result.payments.x - 260 / 2).toBeGreaterThan(480 + 300 / 2);
    expect(fixed).toEqual([
      { id: 'users', x: 100, y: 100, width: 240, height: 120 },
      { id: 'orders', x: 480, y: 360, width: 300, height: 180 },
    ]);
  });

  it('resolves collisions between additions without moving pinned nodes', () => {
    const pending = [
      { id: 'refunds', width: 260, height: 160, neighborIds: ['orders'] },
      { id: 'payments', width: 260, height: 140, neighborIds: ['orders'] },
      { id: 'audit', width: 220, height: 100, neighborIds: [] },
    ];
    const result = placeIncrementalNodes(fixed, pending);
    const ordered = pending.map((node) => ({ ...node, ...result[node.id] }));

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual((a.height + b.height) / 2 + 48);
      }
    }
  });

  it('is deterministic regardless of pending iteration order', () => {
    const pending = [
      { id: 'zeta', width: 220, height: 100, neighborIds: [] },
      { id: 'alpha', width: 240, height: 120, neighborIds: ['users'] },
    ];
    expect(placeIncrementalNodes(fixed, pending)).toEqual(
      placeIncrementalNodes(fixed, [...pending].reverse()),
    );
  });
});
