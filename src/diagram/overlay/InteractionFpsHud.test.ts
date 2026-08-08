import { describe, expect, it } from 'vitest';
import { smoothFrameInterval } from './InteractionFpsHud';

describe('smoothFrameInterval', () => {
  it('starts from the first real canvas-update interval', () => {
    expect(smoothFrameInterval(null, 1000 / 60)).toBeCloseTo(1000 / 60, 5);
  });

  it('reacts to a slower frame without replacing the whole signal', () => {
    expect(smoothFrameInterval(10, 30)).toBeCloseTo(17, 5);
  });

  it('resets after invalid input or a pause in canvas movement', () => {
    expect(smoothFrameInterval(10, 0)).toBeNull();
    expect(smoothFrameInterval(10, Number.NaN)).toBeNull();
    expect(smoothFrameInterval(10, 300)).toBeNull();
  });
});
