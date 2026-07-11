import type { Core } from 'cytoscape';
import type { Schema, Table } from '../parser/types';
import type { ModulesResult } from '../infer/inferModules';
import { colorForTableModule } from '../infer/inferModules';
import type { DisplayOptions } from '../store';
import {
  columnRoleBadge,
  measureText,
  shortType,
  HEADER_HEIGHT,
  SUBTITLE_HEIGHT,
  FIELD_ROW_HEIGHT,
  COMMENT_LINE_HEIGHT,
  ROW_BORDER,
  SUBTITLE_BORDER,
} from '../diagram/buildGraph';
import { parseEndpoint, routeToPoints } from '../diagram/routing/channelRoute';

/**
 * Standalone SVG renderer for the ER diagram. Independent of cytoscape's
 * own png/svg export because (a) those only render cy elements, not the
 * React HTML overlays where the actual card content lives, (b) we want a
 * vector SVG that opens cleanly in any browser/editor, and (c) the PNG
 * exporter rasterizes this same SVG so PNG and SVG are guaranteed to look
 * identical, with the card content intact.
 */

export type ExportTheme = 'light' | 'dark';

export interface SvgRenderOpts {
  schema: Schema;
  modules: ModulesResult;
  /** table name → set of column names that act as FK source (for the FK badge). */
  fkSourceColumns: Map<string, Set<string>>;
  /** Each fk edge with whether it should be drawn as dashed (pending) or solid. */
  display: DisplayOptions;
  /** Padding around the bounding box of all content, in SVG user units. */
  padding?: number;
  /** Color theme for the exported diagram. Defaults to light. */
  theme?: ExportTheme;
}

const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const HEADER_PAD_X = 8;
const ROW_PAD_X = 8;
const BADGE_COL_WIDTH = 38;

interface BadgePalette {
  bg: string;
  fg: string;
  border: string;
}

interface ExportPalette {
  background: string;
  cardBody: string;
  rowBorder: string;
  subtitleBg: string;
  textPrimary: string;
  textMuted: string;
  pkRowBg: string;
  pkRowOpacity: number;
  badges: Record<'PK' | 'U' | 'I' | 'FK', BadgePalette>;
}

const LIGHT_PALETTE: ExportPalette = {
  background: '#ffffff',
  cardBody: '#ffffff',
  rowBorder: '#eceef2', // ink-100
  subtitleBg: '#fafbfd',
  textPrimary: '#1f2235', // ink-800
  textMuted: '#7a82a0', // ink-400
  pkRowBg: '#fef3c7', // amber-100
  pkRowOpacity: 0.5,
  badges: {
    PK: { bg: '#fef3c7', fg: '#a16207', border: '#fcd34d' },
    U: { bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' },
    I: { bg: '#eceef2', fg: '#3f465e', border: '#d3d7e0' },
    FK: { bg: '#e0f2fe', fg: '#0369a1', border: '#7dd3fc' },
  },
};

// Mirrors the on-screen palette (`dark:bg-inkd-100`, badge `dark:bg-*-900/40`
// `dark:text-*-300`, etc.) so PNG/SVG exports look like the dark canvas. The
// translucent on-screen tints (e.g. `bg-amber-900/40`) are flattened to opaque
// hex pre-blended over the card background so SVG/PNG renderers without
// alpha-blending fidelity still reproduce the same visual result.
const DARK_PALETTE: ExportPalette = {
  background: '#0b1020', // inkd-50
  cardBody: '#111728', // inkd-100
  rowBorder: '#262d44', // inkd-300
  subtitleBg: '#1c2237', // inkd-200
  textPrimary: '#d6dbeb', // inkd-800
  textMuted: '#838eb4', // inkd-600
  pkRowBg: '#78350f', // amber-900
  pkRowOpacity: 0.2,
  badges: {
    PK: { bg: '#3a2410', fg: '#fcd34d', border: '#92560a' },
    U: { bg: '#241b3a', fg: '#c4b5fd', border: '#5e3eb8' },
    I: { bg: '#1c2237', fg: '#b0b7d3', border: '#262d44' },
    FK: { bg: '#0c2438', fg: '#7dd3fc', border: '#1a608f' },
  },
};

function paletteFor(theme: ExportTheme): ExportPalette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

interface NodeEntry {
  id: string;
  table: Table;
  // Top-left corner of card (model coords, becomes <g transform=translate>).
  x: number;
  y: number;
  w: number;
  h: number;
  moduleKey: string;
  header: string; // background color
  border: string;
  text: string; // header text color
}

interface EdgeEntry {
  id: string;
  /** sx, sy = absolute source endpoint (model coords); same for tx, ty. */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  color: string;
  /** Solid (explicit / accepted) vs dashed (pending inferred). */
  dashed: boolean;
  /** Faded line for low-confidence pending FKs. */
  faint: boolean;
  /** 'logical' = undirected business-key link: dot pattern + circle markers
   *  at BOTH ends instead of the FK triangle. Mirrors style.ts. */
  kind: 'fk' | 'logical';
  /** Absolute orthogonal polyline — the same path the canvas draws. */
  routePoints: string;
}

export function buildDiagramSvg(cy: Core, opts: SvgRenderOpts): string {
  const { schema, modules, fkSourceColumns, display } = opts;
  const padding = opts.padding ?? 32;
  const darkExport = (opts.theme ?? 'light') === 'dark';
  const palette = paletteFor(opts.theme ?? 'light');

  // ---------- Collect node entries from current cy state -----------------
  const tableByName = new Map(schema.tables.map((t) => [t.name, t] as const));
  const nodes: NodeEntry[] = [];
  cy.nodes().forEach((n) => {
    const rawName = (n.data('rawName') as string) ?? '';
    const table = tableByName.get(rawName);
    if (!table) return;
    const w = (n.data('boxWidth') as number) ?? 240;
    const h = (n.data('boxHeight') as number) ?? 28;
    const pos = n.position();
    const moduleKey = (n.data('moduleKey') as string) ?? '';
    const color = colorForTableModule(table.name, modules.byTable, modules.modules);
    nodes.push({
      id: n.id(),
      table,
      x: pos.x - w / 2,
      y: pos.y - h / 2,
      w,
      h,
      moduleKey,
      header: color.header,
      border: color.border,
      text: color.text,
    });
  });

  // ---------- Collect edge entries (use the canvas-computed endpoints) ---
  const edges: EdgeEntry[] = [];
  cy.edges().forEach((e) => {
    const src = e.source();
    const tgt = e.target();
    const srcEndpoint = parseEndpoint(e.data('srcEndpoint'));
    const tgtEndpoint = parseEndpoint(e.data('tgtEndpoint'));
    if (!srcEndpoint || !tgtEndpoint) return;
    const sPos = src.position();
    const tPos = tgt.position();
    edges.push({
      id: e.id(),
      sx: sPos.x + srcEndpoint.x,
      sy: sPos.y + srcEndpoint.y,
      tx: tPos.x + tgtEndpoint.x,
      ty: tPos.y + tgtEndpoint.y,
      // Match the on-screen canvas: dark exports use the visibility-lifted
      // `colorDark` so FK lines don't vanish on the dark export background.
      color:
        ((darkExport ? (e.data('colorDark') ?? e.data('color')) : e.data('color')) as string) ??
        palette.textMuted,
      dashed: e.data('lineStyle') === 'dashed',
      faint: e.data('confidence') === 'low' && e.data('lineStyle') === 'dashed',
      kind: (e.data('kind') as 'fk' | 'logical' | undefined) ?? 'fk',
      routePoints: (e.data('routePoints') as string | undefined) ?? '',
    });
  });

  // ---------- Bounding box ----------------------------------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  // Edges can also extend beyond nodes (arrowhead overshoot, or a hand-dragged
  // bend pulled outside the cards), be safe — fold every route point too.
  for (const e of edges) {
    if (e.sx < minX) minX = e.sx;
    if (e.tx < minX) minX = e.tx;
    if (e.sx > maxX) maxX = e.sx;
    if (e.tx > maxX) maxX = e.tx;
    if (e.sy < minY) minY = e.sy;
    if (e.ty < minY) minY = e.ty;
    if (e.sy > maxY) maxY = e.sy;
    if (e.ty > maxY) maxY = e.ty;
    for (const p of routeToPoints(e.routePoints)) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) {
    // Empty schema fallback.
    return emptySvg(palette);
  }
  const vbX = Math.floor(minX - padding);
  const vbY = Math.floor(minY - padding);
  const vbW = Math.ceil(maxX - minX + padding * 2);
  const vbH = Math.ceil(maxY - minY + padding * 2);

  // ---------- Build SVG --------------------------------------------------
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
      `viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}" ` +
      `font-family="${FONT_FAMILY}">`,
  );
  // Theme-aware background — matches the on-canvas page background so the
  // exported file looks like what the user sees on screen.
  parts.push(
    `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${palette.background}"/>`,
  );

  // Marker definitions, deduped per (shape, color): FK edges use a triangle
  // arrowhead, logical (business-key) edges an undirected circle at both ends.
  const arrowColors = new Set(edges.filter((e) => e.kind !== 'logical').map((e) => e.color));
  const dotColors = new Set(edges.filter((e) => e.kind === 'logical').map((e) => e.color));
  parts.push('<defs>');
  for (const color of arrowColors) {
    const id = arrowId(color);
    // markerUnits=userSpaceOnUse keeps arrow size independent of stroke width.
    parts.push(
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" ` +
        `markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">` +
        `<polygon points="0,0 10,5 0,10" fill="${color}"/>` +
        `</marker>`,
    );
  }
  for (const color of dotColors) {
    parts.push(
      `<marker id="${dotId(color)}" viewBox="0 0 10 10" refX="5" refY="5" ` +
        `markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse">` +
        `<circle cx="5" cy="5" r="3.2" fill="${color}"/>` +
        `</marker>`,
    );
  }
  parts.push('</defs>');

  // Edges (under nodes so they don't draw over card bodies).
  parts.push('<g data-layer="edges">');
  for (const e of edges) {
    parts.push(renderEdge(e));
  }
  parts.push('</g>');

  // Nodes.
  parts.push('<g data-layer="nodes">');
  for (const n of nodes) {
    parts.push(renderNode(n, fkSourceColumns.get(n.table.name), display, palette));
  }
  parts.push('</g>');

  parts.push('</svg>');
  return parts.join('');
}

function emptySvg(palette: ExportPalette): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `viewBox="0 0 400 80" width="400" height="80">` +
    `<rect width="400" height="80" fill="${palette.background}"/>` +
    `<text x="200" y="44" text-anchor="middle" font-family="${FONT_FAMILY}" ` +
    `font-size="14" fill="${palette.textMuted}">(empty schema)</text>` +
    `</svg>`
  );
}

function renderEdge(e: EdgeEntry): string {
  // Draw the exact orthogonal route computed for the canvas. If routePoints is
  // missing (edge added before the canvas ran its first endpoint pass) fall
  // back to a straight line between the recorded endpoints.
  const points = e.routePoints || `${fmt(e.sx)},${fmt(e.sy)} ${fmt(e.tx)},${fmt(e.ty)}`;
  const stroke = e.color;
  if (e.kind === 'logical') {
    // Undirected business-key link — dot pattern, circle marker at BOTH ends,
    // pending links faded (mirrors the canvas: dotted + opacity for the
    // accepted/pending bit).
    const opacity = e.dashed ? ' opacity="0.45"' : ' opacity="0.85"';
    return (
      `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.6" ` +
      `stroke-dasharray="2 4" marker-start="url(#${dotId(stroke)})" ` +
      `marker-end="url(#${dotId(stroke)})"${opacity}/>`
    );
  }
  const dash = e.dashed ? ' stroke-dasharray="6 4"' : '';
  const opacity = e.faint ? ' opacity="0.55"' : ' opacity="0.85"';
  return (
    `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.6" ` +
    `marker-end="url(#${arrowId(stroke)})"${dash}${opacity}/>`
  );
}

function renderNode(
  n: NodeEntry,
  fkCols: Set<string> | undefined,
  display: DisplayOptions,
  palette: ExportPalette,
): string {
  const { table, x, y, w, h } = n;
  const parts: string[] = [];

  // Card body (shadow simulated via 2 stacked rects; SVG <filter> would work
  // too but adds an external dep on a defined filter id).
  parts.push(`<g transform="translate(${fmt(x)},${fmt(y)})">`);
  parts.push(
    `<rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="6" ry="6" ` +
      `fill="${palette.cardBody}" stroke="${escapeAttr(n.border)}" stroke-width="1"/>`,
  );

  // Header bar.
  parts.push(
    `<rect x="0" y="0" width="${fmt(w)}" height="${HEADER_HEIGHT}" rx="6" ry="6" ` +
      `fill="${escapeAttr(n.header)}"/>` +
      // Cover the bottom corners of the rounded header rect so the header
      // appears flat-bottomed against the body.
      `<rect x="0" y="${HEADER_HEIGHT - 6}" width="${fmt(w)}" height="6" ` +
      `fill="${escapeAttr(n.header)}"/>`,
  );

  // Header text: table name (left) + module label (right). Shards badge in middle if any.
  const nameY = HEADER_HEIGHT / 2 + 4.5; // baseline tuned for 13px
  parts.push(
    `<text x="${HEADER_PAD_X}" y="${fmt(nameY)}" font-size="13" font-weight="600" ` +
      `fill="${escapeAttr(n.text)}">${escapeText(table.name)}</text>`,
  );

  // Right-side header content: shards badge, then module label.
  let rightCursor = w - HEADER_PAD_X;
  if (n.moduleKey) {
    const mw = measureText(n.moduleKey, 10);
    parts.push(
      `<text x="${fmt(rightCursor)}" y="${fmt(nameY - 0.5)}" font-size="10" ` +
        `text-anchor="end" fill="${escapeAttr(n.text)}" opacity="0.85">${escapeText(n.moduleKey)}</text>`,
    );
    rightCursor -= mw + 8;
  }
  if (table.shardInfo) {
    const shardLabel = `shards: ${table.shardInfo.shards.length}`;
    const sw = measureText(shardLabel, 9, '600') + 8;
    parts.push(
      `<rect x="${fmt(rightCursor - sw)}" y="${fmt(HEADER_HEIGHT / 2 - 7)}" ` +
        `width="${fmt(sw)}" height="13" rx="3" ry="3" ` +
        `fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.3)"/>`,
    );
    parts.push(
      `<text x="${fmt(rightCursor - sw / 2)}" y="${fmt(HEADER_HEIGHT / 2 + 3)}" font-size="9" ` +
        `font-weight="600" text-anchor="middle" fill="${escapeAttr(n.text)}">${escapeText(shardLabel)}</text>`,
    );
  }

  // Subtitle (table-level comment).
  const hasSubtitle = !!(table.comment && table.comment.trim());
  let cursorY = HEADER_HEIGHT;
  if (hasSubtitle) {
    parts.push(
      `<rect x="0" y="${cursorY}" width="${fmt(w)}" height="${SUBTITLE_HEIGHT + SUBTITLE_BORDER}" ` +
        `fill="${palette.subtitleBg}"/>` +
        `<line x1="0" y1="${cursorY + SUBTITLE_HEIGHT}" x2="${fmt(w)}" y2="${cursorY + SUBTITLE_HEIGHT}" ` +
        `stroke="${palette.rowBorder}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${ROW_PAD_X}" y="${cursorY + SUBTITLE_HEIGHT / 2 + 4}" font-size="10.5" font-style="italic" ` +
        `fill="${palette.textMuted}">${escapeText(clipText(table.comment!, w - ROW_PAD_X * 2, 10.5))}</text>`,
    );
    cursorY += SUBTITLE_HEIGHT + SUBTITLE_BORDER;
  }

  // Column rows.
  const visibleCols = display.onlyPk
    ? table.columns.filter((c) => c.isPrimaryKey || table.primaryKey.includes(c.name))
    : table.columns;
  for (const col of visibleCols) {
    const role = columnRoleBadge(col, table, display.showIndex);
    const isPk = role === 'PK';
    const isFk = fkCols?.has(col.name) ?? false;

    // Top border line.
    parts.push(
      `<line x1="0" y1="${cursorY}" x2="${fmt(w)}" y2="${cursorY}" ` +
        `stroke="${palette.rowBorder}" stroke-width="1"/>`,
    );
    cursorY += ROW_BORDER;

    // PK row background tint.
    if (isPk) {
      parts.push(
        `<rect x="0" y="${cursorY}" width="${fmt(w)}" height="${FIELD_ROW_HEIGHT}" ` +
          `fill="${palette.pkRowBg}" opacity="${palette.pkRowOpacity}"/>`,
      );
    }

    const rowMid = cursorY + FIELD_ROW_HEIGHT / 2;
    // Badges: PK / FK / U / I (PK + FK can coexist).
    let badgeX = ROW_PAD_X;
    if (role) {
      parts.push(badgeSvg(role as 'PK' | 'U' | 'I', badgeX, rowMid - 6.5, palette));
      badgeX += 18;
    }
    if (isFk) {
      parts.push(badgeSvg('FK', badgeX, rowMid - 6.5, palette));
      badgeX += 18;
    }

    // Field name (left of right-side type).
    const typeText = display.showType ? shortType(col.rawType) : '';
    const typeWidth = typeText ? measureText(typeText, 10.5) : 0;
    const nameXStart = ROW_PAD_X + BADGE_COL_WIDTH;
    const nameMaxW = w - nameXStart - (typeText ? typeWidth + 12 : 0) - ROW_PAD_X;
    const nameClipped = clipText(col.name, nameMaxW, 12);
    parts.push(
      `<text x="${fmt(nameXStart)}" y="${fmt(rowMid + 4)}" font-size="12" ` +
        `font-weight="${isPk ? 600 : 400}" fill="${palette.textPrimary}">${escapeText(nameClipped)}</text>`,
    );

    if (typeText) {
      parts.push(
        `<text x="${fmt(w - ROW_PAD_X)}" y="${fmt(rowMid + 3.5)}" font-size="10.5" ` +
          `text-anchor="end" fill="${palette.textMuted}">${escapeText(typeText)}</text>`,
      );
    }
    cursorY += FIELD_ROW_HEIGHT;

    // Inline column comment (when enabled).
    if (display.showComment && col.comment) {
      const commentClipped = clipText(col.comment, w - ROW_PAD_X * 2, 10.5);
      parts.push(
        `<text x="${ROW_PAD_X}" y="${cursorY + COMMENT_LINE_HEIGHT - 3}" font-size="10.5" ` +
          `font-style="italic" fill="${palette.textMuted}">${escapeText(commentClipped)}</text>`,
      );
      cursorY += COMMENT_LINE_HEIGHT;
    }
  }

  parts.push('</g>');
  return parts.join('');
}

function badgeSvg(
  kind: 'PK' | 'U' | 'I' | 'FK',
  x: number,
  y: number,
  palette: ExportPalette,
): string {
  const c = palette.badges[kind];
  return (
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="16" height="13" rx="3" ry="3" ` +
    `fill="${c.bg}" stroke="${c.border}" stroke-width="1"/>` +
    `<text x="${fmt(x + 8)}" y="${fmt(y + 9.5)}" font-size="8.5" font-weight="700" ` +
    `text-anchor="middle" fill="${c.fg}">${kind}</text>`
  );
}

/**
 * Truncate a string with a trailing ellipsis so its rendered width fits within
 * `maxW`. Uses the same `measureText` the layout already uses so the result
 * always matches the card the user sees on screen.
 */
function clipText(s: string, maxW: number, fontSize: number): string {
  if (maxW <= 0) return '';
  if (measureText(s, fontSize) <= maxW) return s;
  // Binary search for the right cut so we don't measure every prefix.
  let lo = 0;
  let hi = s.length;
  const ELLIPSIS = '…';
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (measureText(s.slice(0, mid) + ELLIPSIS, fontSize) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo) + ELLIPSIS : ELLIPSIS;
}

/** XML-escape text content. Also escapes apostrophes so the output is safe
 *  to embed inside a single-quoted XML attribute or external host document
 *  (most parsers tolerate `'` in text content, but lenient embedders may not). */
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

/** XML-escape an attribute value (double-quoted). Both `"` and `'` are
 *  escaped so the value is safe inside either quote style without
 *  re-checking the caller's quoting choice. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function fmt(n: number): string {
  // Avoid scientific notation and excess precision in the output SVG.
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

function arrowId(color: string): string {
  return 'arrow-' + color.replace(/[^a-zA-Z0-9]/g, '');
}

/** Circle endpoint marker for undirected logical (business-key) links. */
function dotId(color: string): string {
  return 'dot-' + color.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Rasterize an SVG string to a PNG data URL at the given scale. The browser
 * decodes the SVG natively, so the result matches what the user would see
 * if they opened the SVG file directly.
 *
 * `bgColor` is the fallback fill drawn under the SVG — the SVG already paints
 * its own background rect, but pre-filling the canvas makes export robust
 * against future changes that introduce transparency.
 */
export function svgToPngDataUrl(
  svgString: string,
  scale: number = 2,
  bgColor: string = '#ffffff',
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Re-extract the explicit width/height from the SVG so the canvas has the
    // right intrinsic size. (img.naturalWidth can vary by browser for SVG.)
    const wMatch = /\swidth="(\d+(?:\.\d+)?)"/.exec(svgString);
    const hMatch = /\sheight="(\d+(?:\.\d+)?)"/.exec(svgString);
    const w = wMatch ? parseFloat(wMatch[1]) : 1024;
    const h = hMatch ? parseFloat(hMatch[1]) : 768;

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('canvas 2d context unavailable'));
          return;
        }
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG image failed to load: ' + String(e)));
    };
    img.src = url;
  });
}

/** Expose the palette's background color so callers (PNG export) can match
 *  the theme background of the SVG they just built. */
export function exportBackgroundColor(theme: ExportTheme): string {
  return paletteFor(theme).background;
}
