import { describe, expect, it } from 'vitest';
import { nextZoomStop, ZOOM_STOPS } from './zoom';

describe('nextZoomStop', () => {
  it('uses the compact 15–100% scale', () => {
    expect(ZOOM_STOPS).toEqual([0.15, 0.2, 0.33, 0.5, 0.75, 1]);
  });

  it('moves to the adjacent fixed stop', () => {
    expect(nextZoomStop(0.75, 1)).toBe(1);
    expect(nextZoomStop(0.75, -1)).toBe(0.5);
  });

  it('snaps an off-ladder zoom outward', () => {
    expect(nextZoomStop(0.48, 1)).toBe(0.5);
    expect(nextZoomStop(0.48, -1)).toBe(0.33);
    expect(nextZoomStop(0.22, 1)).toBe(0.33);
    expect(nextZoomStop(0.22, -1)).toBe(0.2);
  });

  it('clamps at the ladder boundaries', () => {
    expect(nextZoomStop(1, 1)).toBe(1);
    expect(nextZoomStop(0.15, -1)).toBe(0.15);
  });
});
