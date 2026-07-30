import { describe, expect, it } from 'vitest';
import { constrainDragDelta, snapVerticalDelta } from './constrainedDrag';

describe('constrained table dragging', () => {
  it('locks Alt dragging to the horizontal axis', () => {
    expect(constrainDragDelta(40, 24, 2, { altKey: true, shiftKey: false })).toEqual({
      dx: 20,
      dy: 0,
      axis: 'horizontal',
    });
  });

  it('locks Shift dragging to quarter-speed vertical movement', () => {
    expect(constrainDragDelta(40, 24, 2, { altKey: false, shiftKey: true })).toEqual({
      dx: 0,
      dy: 3,
      axis: 'vertical',
    });
  });

  it('snaps only when a straight-line target is within the threshold', () => {
    expect(snapVerticalDelta(19, [4, 20, 60], 2)).toEqual({ dy: 20, snapped: true });
    expect(snapVerticalDelta(16, [4, 20, 60], 2)).toEqual({ dy: 16, snapped: false });
  });
});
