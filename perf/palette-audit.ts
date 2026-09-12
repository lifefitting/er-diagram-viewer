/** bun perf/palette-audit.ts
 * Offline display-color audit, not shipped in the app. No files are modified.
 * CVD matrices: Machado et al. 2009, severity 100 (linear sRGB), verified against
 * https://raw.githubusercontent.com/njsmith/colorspacious/master/colorspacious/cvd.py
 * Distances are CIELAB D65 ΔE76, NOT CIEDE2000 or a universal CVD pass/fail rule.
 */
import { MODULE_PALETTES } from '../src/infer/inferModules';
import { PALETTE_OPTIONS } from '../src/infer/paletteCatalog';
import {
  contrastRatio,
  mixHex,
  paletteColorAt,
  LIGHT_CANVAS,
  DARK_CANVAS,
  REGULAR_EDGE_OPACITY,
} from '../src/infer/paletteColor';

const matrices = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
function lab(hex: string, matrix: number[][]): number[] {
  const rgb = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = matrix.map((row) =>
    Math.max(
      0,
      Math.min(
        1,
        row.reduce((sum, v, i) => sum + v * rgb[i], 0),
      ),
    ),
  );
  const f = (v: number) => (v > (6 / 29) ** 3 ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function separation(colors: string[]) {
  const adjacent: number[] = [],
    allPairs: number[] = [];
  for (const matrix of Object.values(matrices)) {
    const labs = colors.map((c) => lab(c, matrix));
    for (let i = 0; i < labs.length; i++)
      for (let j = i + 1; j < labs.length; j++) {
        const distance = Math.hypot(...labs[i].map((v, k) => v - labs[j][k]));
        allPairs.push(distance);
        if (j === i + 1) adjacent.push(distance);
      }
  }
  return { adjacent: Math.min(...adjacent), allPairs: Math.min(...allPairs) };
}
const rounded = (value: number) => Number(value.toFixed(2));
const report = PALETTE_OPTIONS.map(({ id, label }) => {
  const slots = MODULE_PALETTES[id];
  const extended = Array.from({ length: 160 }, (_, i) => paletteColorAt(slots, i));
  const text = Math.min(...extended.map((c) => contrastRatio(c.header, c.text)));
  const light = Math.min(
    ...extended.map((c) =>
      contrastRatio(mixHex(LIGHT_CANVAS, c.edgeLight!, REGULAR_EDGE_OPACITY), LIGHT_CANVAS),
    ),
  );
  const dark = Math.min(
    ...extended.map((c) =>
      contrastRatio(mixHex(DARK_CANVAS, c.headerDark!, REGULAR_EDGE_OPACITY), DARK_CANVAS),
    ),
  );
  if (text < 4.5 || light < 3 || dark < 3) throw new Error(`${id}: contrast regression`);
  const headers = separation(slots.map((c) => c.header));
  const darkEdges = separation(
    slots.map((c) => mixHex(DARK_CANVAS, c.headerDark!, REGULAR_EDGE_OPACITY)),
  );
  return {
    id,
    label,
    textMin160: rounded(text),
    lightEdgeMin160: rounded(light),
    darkEdgeMin160: rounded(dark),
    uniqueHeaders160: new Set(extended.map((c) => c.header)).size,
    headerCvdAdjacent12: rounded(headers.adjacent),
    headerCvdAllPairs12: rounded(headers.allPairs),
    darkEdgeCvdAdjacent12: rounded(darkEdges.adjacent),
  };
});
console.table(report);
console.log(
  'CVD columns: minimum across protan/deutan/tritan severity 100; ΔE76 is diagnostic only. Text/edge contrast checks pass.',
);
