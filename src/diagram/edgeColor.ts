/**
 * Edge (FK connector) color handling for dark mode.
 *
 * On screen and in exports, an FK line is colored by its source table's module
 * `header` color. Those colors are hand-tuned for a LIGHT canvas, so the dark
 * end of some palettes — the whole `mono` scale (slate-900 … sky-900), `earth`
 * browns/charcoal, the darker `vibrant` hues — renders as a near-invisible line
 * on the dark canvas/export background (`#0b1020`).
 *
 * `darkEdgeColor` lifts such colors to a minimum HSL lightness while keeping
 * their hue + saturation, so each module's edge stays distinguishable yet
 * clearly visible. Colors that are already light enough (e.g. the whole
 * `pastel` palette) pass through unchanged.
 */

/** Minimum lightness (0–1) an edge color may have on the dark canvas. */
export const DARK_EDGE_LIGHTNESS_FLOOR = 0.58;

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Lightness (0–1) of a hex color, or null if it can't be parsed. Exported for tests. */
export function lightnessOf(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return rgbToHsl(rgb[0], rgb[1], rgb[2])[2];
}

/**
 * Return a version of `hex` that is visible on the dark canvas: if its lightness
 * is below `floor`, raise the lightness to `floor` (keeping hue + saturation);
 * otherwise return it unchanged. Unparseable input is returned as-is.
 */
export function darkEdgeColor(hex: string, floor: number = DARK_EDGE_LIGHTNESS_FLOOR): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (l >= floor) return hex;
  const [r, g, b] = hslToRgb(h, s, floor);
  return rgbToHex(r, g, b);
}
