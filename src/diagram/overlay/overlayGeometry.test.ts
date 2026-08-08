import { describe, expect, it } from 'vitest';
import { applyOverlayGeometry } from './overlayGeometry';

describe('applyOverlayGeometry', () => {
  it('writes transform and size, then skips an unchanged frame', () => {
    const style: Record<string, string> = {};
    const element = { style } as unknown as HTMLElement;
    expect(applyOverlayGeometry(element, { x: 12, y: 34, w: 240, h: 80 })).toBe(true);
    expect(style).toEqual({
      transform: 'translate3d(12px, 34px, 0)',
      width: '240px',
      height: '80px',
    });
    expect(applyOverlayGeometry(element, { x: 12, y: 34, w: 240, h: 80 })).toBe(false);
    expect(applyOverlayGeometry(element, { x: 13, y: 34, w: 240, h: 80 })).toBe(true);
  });
});
