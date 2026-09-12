import { describe, expect, it } from 'vitest';
import { MODULE_PALETTES, inferModules } from './inferModules';
import { PALETTE_OPTIONS } from './paletteCatalog';
import {
  contrastRatio,
  mixHex,
  paletteColorAt,
  LIGHT_CANVAS,
  DARK_CANVAS,
  REGULAR_EDGE_OPACITY,
  readableModuleColor,
} from './paletteColor';
import { parseSql } from '../parser';

describe('module palette readability', () => {
  it.each([
    ['#66ccee', '#ffffff'],
    ['#223344', '#1f2937'],
  ])('adjusts %s to retain the fixed foreground %s', (header, text) => {
    const color = readableModuleColor({ header, text, border: '#aabbcc', tint: '#eeeeee' });
    expect(color.text).toBe(text);
    expect(color.header).not.toBe(header);
    expect(contrastRatio(color.header, color.text)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(PALETTE_OPTIONS)('$id uses one header text color, including overflow slots', ({ id }) => {
    const colors = Array.from({ length: 160 }, (_, i) => paletteColorAt(MODULE_PALETTES[id], i));
    expect(new Set(colors.map((c) => c.text))).toEqual(
      new Set([id === 'pastel' ? '#1f2937' : '#ffffff']),
    );
  });
  it('uses the WCAG sRGB contrast reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 3);
    expect(mixHex('#000000', '#ffffff', 0.6)).toBe('#999999');
  });

  it.each(PALETTE_OPTIONS)(
    '$id keeps text and regular connectors readable through 160 modules',
    ({ id }) => {
      const palette = MODULE_PALETTES[id];
      expect(palette).toHaveLength(12);
      const colors = Array.from({ length: 160 }, (_, i) => paletteColorAt(palette, i));
      expect(new Set(colors.slice(0, 12).map((c) => c.header)).size).toBe(12);
      // Extended shades should not collapse into the old single gray fallback.
      expect(new Set(colors.slice(12).map((c) => c.header)).size).toBeGreaterThan(130);
      colors.forEach((color, i) => {
        expect(color, `slot ${i} is cached`).toBe(paletteColorAt(palette, i));
        if (i < 12) expect(color).toBe(palette[i]);
        expect(contrastRatio(color.header, color.text), `text ${id}/${i}`).toBeGreaterThanOrEqual(
          4.5,
        );
        for (const [background, edge] of [
          [LIGHT_CANVAS, color.edgeLight!],
          ['#ffffff', color.edgeLight!],
          [DARK_CANVAS, color.headerDark!],
        ]) {
          expect(edge).toMatch(/^#[0-9a-f]{6}$/i);
          expect(
            contrastRatio(mixHex(background, edge, REGULAR_EDGE_OPACITY), background),
            `edge ${id}/${i}/${background}`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    },
  );

  it.each(PALETTE_OPTIONS)(
    '$id assigns stable non-gray overflow colors independently of SQL order',
    ({ id }) => {
      const statements = Array.from(
        { length: 32 },
        (_, i) =>
          `CREATE TABLE domain${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}_entity (id INT PRIMARY KEY);`,
      );
      const forward = inferModules(parseSql(statements.join('\n')), [], id);
      const backward = inferModules(parseSql(statements.reverse().join('\n')), [], id);
      expect(forward.ordered).toHaveLength(32);
      expect(backward.ordered).toEqual(forward.ordered);
      expect(new Set(forward.ordered.slice(12).map((m) => m.color.header)).size).toBe(20);
    },
  );
});
