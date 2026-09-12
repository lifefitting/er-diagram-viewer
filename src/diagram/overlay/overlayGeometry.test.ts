import { describe, expect, it } from 'vitest';
import { applyOverlayGeometry, overlayTransform } from './overlayGeometry';

describe('overlayTransform', () => {
  it.each([
    [1, 'translate(12px, -35px)'],
    [1.25, 'translate(12.8px, -34.4px)'],
    [2, 'translate(12.5px, -34.5px)'],
    [0, 'translate(12px, -35px)'],
    [NaN, 'translate(12px, -35px)'],
  ])('aligns the origin to physical pixels at DPR %s', (ratio, expected) => {
    expect(overlayTransform(12.45, -34.65, ratio)).toBe(expected);
  });
});

describe('applyOverlayGeometry', () => {
  it('writes transform and size, then skips an unchanged frame', () => {
    const style: Record<string, string> = {};
    const element = { style } as unknown as HTMLElement;
    expect(applyOverlayGeometry(element, { x: 12, y: 34, w: 240, h: 80 })).toBe(true);
    expect(style).toEqual({
      transform: 'translate(12px, 34px)',
      width: '240px',
      height: '80px',
    });
    expect(applyOverlayGeometry(element, { x: 12, y: 34, w: 240, h: 80 })).toBe(false);
    expect(applyOverlayGeometry(element, { x: 13, y: 34, w: 240, h: 80 })).toBe(true);
  });

  it('preserves model geometry and fractional size; re-snaps when DPR changes', () => {
    const style: Record<string, string> = {};
    const element = { style } as unknown as HTMLElement;
    const geometry = Object.freeze({ x: 12.45, y: 34.65, w: 240.25, h: 80.75 });
    applyOverlayGeometry(element, geometry, 1);
    expect(style.transform).toBe('translate(12px, 35px)');
    expect(applyOverlayGeometry(element, { ...geometry, x: 12.49 }, 1)).toBe(false);
    expect(applyOverlayGeometry(element, geometry, 2)).toBe(true);
    expect(style).toEqual({
      transform: 'translate(12.5px, 34.5px)',
      width: '240.25px',
      height: '80.75px',
    });
    expect(geometry.x).toBe(12.45);
  });

  it('does not rewrite layout dimensions when only panning', () => {
    const writes: PropertyKey[] = [];
    const element = {
      style: new Proxy(
        {},
        {
          set: (_target, property) => {
            writes.push(property);
            return true;
          },
        },
      ),
    } as unknown as HTMLElement;
    applyOverlayGeometry(element, { x: 12, y: 34, w: 240, h: 80 });
    writes.length = 0;
    applyOverlayGeometry(element, { x: 14, y: 36, w: 240, h: 80 });
    expect(writes).toEqual(['transform']);
  });
});
