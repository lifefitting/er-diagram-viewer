import { describe, it, expect } from 'vitest';
import { computeEndpointOffset } from './computeEndpointOffset';
import { HEADER_HEIGHT } from '../buildGraph';

describe('computeEndpointOffset', () => {
  it('places the endpoint on the right edge at the row y when expanded', () => {
    const off = computeEndpointOffset(60, false, 200, 120, 'right');
    expect(off.x).toBe(100); // boxWidth / 2
    expect(off.y).toBe(60 - 60); // rowOffsetY - boxHeight/2 = 0
  });

  it('places the endpoint on the left edge for left-side', () => {
    const off = computeEndpointOffset(60, false, 200, 120, 'left');
    expect(off.x).toBe(-100);
  });

  it('snaps to header center when collapsed (rowOffsetY ignored)', () => {
    const off = computeEndpointOffset(999, true, 200, 60, 'right');
    expect(off.y).toBe(HEADER_HEIGHT / 2 - 30);
  });

  it('snaps to node center when expanded but rowOffsetY is null (column missing)', () => {
    const off = computeEndpointOffset(null, false, 200, 120, 'right');
    expect(off.y).toBe(0);
  });
});
