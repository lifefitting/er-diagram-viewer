/** Display-only colors, derived from a persisted palette ID, never archived. */
export interface ModuleColor {
  header: string;
  border: string;
  tint: string;
  text: string;
  /** Light-canvas connector color; independent of a possibly pale header. */
  edgeLight?: string;
  /** Dark-canvas connector color. Kept under its historical property name. */
  headerDark?: string;
}

export const LIGHT_CANVAS = '#f6f8fb';
export const DARK_CANVAS = '#0b1020';
/** The lowest opacity of regular, non-dimmed edges (same-module relations).
 * Low-confidence/pending-logical edges are intentionally fainter. */
export const REGULAR_EDGE_OPACITY = 0.6;

function rgb(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

export function mixHex(color: string, target: string, amount: number): string {
  const a = rgb(color);
  return (
    '#' +
    rgb(target)
      .map((b, i) =>
        Math.round(a[i] + (b - a[i]) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function luminance(hex: string): number {
  const c = rgb(hex).map((value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Once per palette slot, not per frame. Use a neutral blend rather than HSL
 * lightness lifting, which can turn saturated dark teal into neon. */
function connectorColor(color: string, dark: boolean): string {
  const background = dark ? DARK_CANVAS : LIGHT_CANVAS;
  const target = dark ? '#ffffff' : '#000000';
  const visibleContrast = (candidate: string) =>
    contrastRatio(mixHex(background, candidate, REGULAR_EDGE_OPACITY), background);
  if (visibleContrast(color) >= 3.05) return color;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (visibleContrast(mixHex(color, target, mid)) >= 3.05) hi = mid;
    else lo = mid;
  }
  return mixHex(color, target, hi);
}

/** Honor the palette's fixed foreground. Preserve the original header when
 * readable; otherwise change its brightness instead of changing the text. */
function readableHeader(header: string, text: string): string {
  if (contrastRatio(header, text) >= 4.5) return header;
  const target = luminance(text) > 0.5 ? '#000000' : '#ffffff';
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixHex(header, target, mid), text) >= 4.55) hi = mid;
    else lo = mid;
  }
  return mixHex(header, target, hi);
}

export function readableModuleColor(color: ModuleColor): ModuleColor {
  return {
    ...color,
    header: readableHeader(color.header, color.text),
    edgeLight: connectorColor(color.edgeLight ?? color.header, false),
    headerDark: connectorColor(color.headerDark ?? color.header, true),
  };
}

export function createModuleColor(
  header: string,
  headerDark?: string,
  text = '#ffffff',
): ModuleColor {
  return readableModuleColor({
    header,
    headerDark,
    border: mixHex(header, '#ffffff', 0.52),
    tint: mixHex(header, '#ffffff', 0.94),
    text,
  });
}

const extensions = new WeakMap<readonly ModuleColor[], Map<number, ModuleColor>>();

/** Preserve the primary slots, then extend their hues with deterministic
 * shades. A base-2 low-discrepancy sequence spreads successive
 * tiers out instead of assigning one gray fallback to every remaining module.
 * Called while assigning modules; cached objects are reused by the canvas. */
export function paletteColorAt(palette: readonly ModuleColor[], index: number): ModuleColor {
  if (index < palette.length) return palette[index];
  let cache = extensions.get(palette);
  if (!cache) {
    cache = new Map();
    extensions.set(palette, cache);
  }
  const cached = cache.get(index);
  if (cached) return cached;
  const tier = Math.floor(index / palette.length);
  let n = tier,
    fraction = 0,
    weight = 0.5;
  while (n > 0) {
    fraction += (n % 2) * weight;
    n = Math.floor(n / 2);
    weight /= 2;
  }
  const base = palette[index % palette.length];
  // Move away from the fixed foreground to keep contrast without clamping
  // successive shades to the same readability boundary or flipping text.
  const target = luminance(base.text) > 0.5 ? '#000000' : '#ffffff';
  const color = createModuleColor(
    mixHex(base.header, target, 0.04 + fraction * 0.3),
    undefined,
    base.text,
  );
  cache.set(index, color);
  return color;
}
