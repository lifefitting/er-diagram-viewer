import { describe, it, expect } from 'vitest';
import { clampPanAxis, PAN_MARGIN } from './clampPan';

// Pure per-axis pan clamp. Content span [c1,c2] (model), viewport `size`, zoom z.
// Allowed pan window is [margin - c2*z, size - margin - c1*z]; if empty, the
// desired pan passes through unchanged.
describe('clampPanAxis', () => {
  const SIZE = 1000;
  const Z = 1;

  it('leaves a pan that already keeps content in view untouched', () => {
    // content [0,400] at zoom 1, viewport 1000 → window [120-400, 1000-120-0] = [-280, 880]
    expect(clampPanAxis(100, 0, 400, SIZE, Z)).toBe(100);
  });

  it('clamps a pan that would push content past the near edge', () => {
    // window upper bound = size - margin - c1*z = 1000 - 120 - 0 = 880
    expect(clampPanAxis(5000, 0, 400, SIZE, Z)).toBe(880);
  });

  it('clamps a pan that would push content past the far edge', () => {
    // window lower bound = margin - c2*z = 120 - 400 = -280
    expect(clampPanAxis(-5000, 0, 400, SIZE, Z)).toBe(-280);
  });

  it('returns the desired pan unchanged when content is larger than the window allows', () => {
    // huge content: min (120 - 5000) > ... actually min < max here; craft min > max:
    // content [0, 100000] → min = 120 - 100000 = -99880; max = 1000 - 120 - 0 = 880 → min<max (clamps).
    // To force min>max, content must be small AND offset so margins overlap: c1 large.
    // content [2000, 2100]: min = 120 - 2100 = -1980; max = 1000 - 120 - 2000 = -1120 → min(-1980) < max(-1120), still clamps.
    // Truly empty window needs size < 2*margin: size 200 → max = 200-120-0=80, min=120-400=-280 → min<max.
    // Use a tiny viewport so 2*margin > size + content span:
    const tiny = 100; // < 2*PAN_MARGIN
    // content [0,0] (a point): min = 120 - 0 = 120; max = 100 - 120 - 0 = -20 → min>max → passthrough
    expect(clampPanAxis(42, 0, 0, tiny, Z)).toBe(42);
  });

  it('honors zoom in the window bounds', () => {
    // content [0,400] at zoom 2: min = 120 - 800 = -680; max = 1000 - 120 - 0 = 880
    expect(clampPanAxis(-9999, 0, 400, SIZE, 2)).toBe(-680);
  });

  it('PAN_MARGIN is the documented default', () => {
    expect(PAN_MARGIN).toBe(120);
    // explicit margin arg overrides the default
    expect(clampPanAxis(5000, 0, 400, SIZE, Z, 0)).toBe(1000); // max = 1000 - 0 - 0
  });
});
