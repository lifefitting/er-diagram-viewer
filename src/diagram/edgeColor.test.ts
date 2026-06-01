import { describe, expect, it } from 'vitest';
import { darkEdgeColor, lightnessOf, DARK_EDGE_LIGHTNESS_FLOOR as FLOOR } from './edgeColor';
import { MODULE_PALETTES } from '../infer/inferModules';

describe('darkEdgeColor', () => {
  it('lifts a near-black color to the lightness floor', () => {
    // mono slate-950 — the worst offender on the dark canvas.
    const out = darkEdgeColor('#0f172a');
    expect(out).not.toBe('#0f172a');
    expect(lightnessOf(out)!).toBeGreaterThanOrEqual(FLOOR - 0.01);
  });

  it('leaves already-light colors unchanged', () => {
    // pastel sky header (L ≈ 0.78) is already visible on dark.
    expect(darkEdgeColor('#93c5fd')).toBe('#93c5fd');
    expect(darkEdgeColor('#ffffff')).toBe('#ffffff');
  });

  it('returns unparseable input as-is', () => {
    expect(darkEdgeColor('not-a-color')).toBe('not-a-color');
    expect(darkEdgeColor('#abc')).toBe('#abc');
  });

  it('preserves hue when lifting (a dark blue stays blue)', () => {
    // #1e3a8a (blue-900) → still a blue, just lighter.
    const out = darkEdgeColor('#1e3a8a');
    const [r, g, b] = [
      parseInt(out.slice(1, 3), 16),
      parseInt(out.slice(3, 5), 16),
      parseInt(out.slice(5, 7), 16),
    ];
    expect(b).toBeGreaterThan(r); // blue channel still dominant
    expect(b).toBeGreaterThan(g);
  });

  it('makes EVERY palette header visible on the dark canvas', () => {
    // Regression for the reported bug: with the floor applied, no palette slot
    // (mono / earth / vibrant included) stays below the visibility floor.
    for (const [name, colors] of Object.entries(MODULE_PALETTES)) {
      for (const c of colors) {
        const safe = darkEdgeColor(c.header);
        expect(
          lightnessOf(safe)! >= FLOOR - 0.01,
          `${name} header ${c.header} → ${safe} too dark`,
        ).toBe(true);
      }
    }
  });
});
