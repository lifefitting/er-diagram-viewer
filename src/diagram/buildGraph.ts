import type { ElementDefinition } from 'cytoscape';
import type { Column, ForeignKey, Schema, Table } from '../parser/types';
import { colorForTableModule, type ModulesResult } from '../infer/inferModules';
import { fkKey } from '../infer/inferForeignKeys';
import { darkEdgeColor } from './edgeColor';

export interface BuiltElements {
  elements: ElementDefinition[];
}

export interface BuildDisplayOpts {
  /** Show each column's comment as a second line below the name+type row. */
  showComment: boolean;
  /** Show the inline type column. (Hidden mode produces a much narrower card.) */
  showType: boolean;
}

export interface BuildOptions {
  modules: ModulesResult;
  collapsed: Record<string, boolean>;
  /** Per-table width override (cytoscape model px) set by the resize handle. */
  tableWidths: Record<string, number>;
  display: BuildDisplayOpts;
  /**
   * Per-FK acceptance decisions (keyed by `fkKey`). Used to decide whether an
   * inferred edge should render solid (= accepted) or dashed (= pending).
   * Rejected edges are filtered out upstream by `effectiveForeignKeys` and
   * never reach buildElements.
   */
  decisions: Record<string, 'accept' | 'reject'>;
}

/**
 * Layout constants. Exported because the canvas needs them to compute the
 * vertical offset of a specific column row within a node, so FK edges can be
 * routed to land on the exact field (not just the table card edge).
 */
export const HEADER_HEIGHT = 28;
export const SUBTITLE_HEIGHT = 18;
export const FIELD_ROW_HEIGHT = 20;
export const COMMENT_LINE_HEIGHT = 14;
/**
 * Each column row in the DOM has a 1px `border-t border-ink-100` on the
 * wrapper. Browsers add this 1px on top of the inner `height: FIELD_ROW_HEIGHT`
 * content, so the visual height of one column block is FIELD_ROW_HEIGHT + 1
 * (or +1+COMMENT when comment shown). Same idea for the table subtitle which
 * has a 1px `border-b`. If we don't add these, FK edge endpoints land 1px
 * higher per preceding row — by row 5 the arrowhead is off by 5px from where
 * the FK badge actually is rendered.
 */
export const ROW_BORDER = 1;
export const SUBTITLE_BORDER = 1;
/** Back-compat alias for the column row baseline height. */
export const ROW_HEIGHT = FIELD_ROW_HEIGHT;

export const MIN_WIDTH = 240;
/** Hard upper bound for the algorithmic width; user can still drag wider. */
export const MAX_WIDTH = 560;
/** Maximum width the user can manually drag a card to (handle constraint). */
export const DRAG_MAX_WIDTH = 1200;

// Internal sizing constants used both here and in TableOverlay.
const HEADER_PADDING = 16; // chevron + gaps + right padding
const ROW_HPADDING = 28; // total horizontal padding around field row content
const BADGE_COL_WIDTH = 38; // PK / FK / PK+FK badge column
const TYPE_GAP = 12; // gap between field name and type
const COMMENT_HPADDING = 24; // padding around comment line

// Lazily-created offscreen canvas context for accurate text measurement.
// We can't rely on per-character heuristics because (a) CJK glyphs are ~1.7x
// wider than ASCII, (b) bold vs regular weight differs by ~10%, and (c) Mac
// rendering differs from Linux by several percent. Using the same font stack
// the cards actually render in is the only way to get a width that matches
// what the user sees.
let _measureCtx: CanvasRenderingContext2D | null = null;
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  _measureCtx = canvas.getContext('2d');
  return _measureCtx;
}

/**
 * Pixel width of a string in the given font size/weight from the card font
 * stack. Falls back to a coarse heuristic if running outside a DOM (e.g. unit
 * tests). The DOM path is canonical: card widths are computed using the same
 * measurer that the browser will actually render with, so `whitespace-nowrap`
 * children never overflow the card they were sized for.
 */
/** Same-process cache for `measureText`. Same string at same size/weight is
 *  measured once and reused — `id` / `BIGINT` / `created_at` etc. recur dozens
 *  of times across a schema. The font stack is fixed (FONT_FAMILY constant),
 *  so the cache key only needs the (text, size, weight) triple. */
const measureCache = new Map<string, number>();

export function measureText(s: string, sizePx: number = 12, weight: '400' | '600' = '400'): number {
  const key = `${weight}\0${sizePx}\0${s}`;
  const hit = measureCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = getMeasureCtx();
  let w: number;
  if (!ctx) {
    // SSR / vitest fallback: enough for layout tests, never reached at runtime.
    let acc = 0;
    for (const ch of s) acc += ch.charCodeAt(0) > 0x7f ? 12 : 7;
    w = acc * (sizePx / 12);
  } else {
    ctx.font = `${weight} ${sizePx}px ${FONT_FAMILY}`;
    w = ctx.measureText(s).width;
  }
  measureCache.set(key, w);
  return w;
}

/**
 * Strip the noisy DDL suffixes (NOT NULL, UNSIGNED, DEFAULT …, COMMENT …, etc)
 * and keep just the core `<typename>` or `<typename>(args)`. Falls back to the
 * raw string if no match (very rare — only for completely malformed types).
 *
 *  int(11) UNSIGNED NOT NULL DEFAULT '0'  →  int(11)
 *  varchar(64) CHARACTER SET utf8mb4      →  varchar(64)
 *  decimal(10, 2)                         →  decimal(10,2)
 *  timestamp DEFAULT CURRENT_TIMESTAMP    →  timestamp
 */
export function shortType(raw: string): string {
  const m = raw.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(\([^)]*\))?/);
  if (!m) return raw.trim();
  const name = m[1];
  const args = (m[2] ?? '').replace(/\s+/g, '');
  return name + args;
}

export function tableBoxSize(
  table: Table,
  collapsed: boolean,
  display: BuildDisplayOpts,
  moduleKey: string,
  widthOverride?: number,
): { width: number; height: number } {
  // --- Width measurement -------------------------------------------------
  // Header: chevron + bold name + optional shards badge + module label + gaps.
  // Every element is `whitespace-nowrap shrink-0`, so the card width must
  // reserve space for all of them or the table name gets clipped (which the
  // user explicitly does NOT want).
  const headerNameW = measureText(table.name, 13, '600');
  const shardsW = table.shardInfo
    ? measureText(`shards: ${table.shardInfo.shards.length}`, 9, '600') + 10
    : 0;
  const moduleW = moduleKey ? measureText(moduleKey, 10) + 8 : 0;
  // Extra +6 safety margin in the header — sub-pixel rounding plus the chevron
  // button's hover padding can chew up 2-3px the browser doesn't tell us about.
  const headerWidth = HEADER_PADDING + headerNameW + shardsW + moduleW + 12 + 6;

  // Per-column row: badge(38) + name(12px) + gap(12) + type(10.5px) + padding.
  let rowsWidth = 0;
  let commentMaxW = 0;
  for (const col of table.columns) {
    const nameW = measureText(col.name, 12);
    const typeW = display.showType ? measureText(shortType(col.rawType), 10.5) : 0;
    const rowW = BADGE_COL_WIDTH + nameW + (typeW ? TYPE_GAP + typeW : 0) + ROW_HPADDING;
    if (rowW > rowsWidth) rowsWidth = rowW;
    if (display.showComment && col.comment) {
      const cw = measureText(col.comment, 10.5) + COMMENT_HPADDING;
      if (cw > commentMaxW) commentMaxW = cw;
    }
  }

  // Table-level comment (subtitle) influences width too.
  const subtitleW = !collapsed && table.comment ? measureText(table.comment, 10.5) + 24 : 0;

  const ideal = Math.max(headerWidth, rowsWidth, commentMaxW, subtitleW, MIN_WIDTH);
  const algorithmic = Math.min(MAX_WIDTH, ideal);
  // Manual override wins, clamped to a sane range so a stray drag can't
  // corrupt the layout. We do allow values *above* MAX_WIDTH here — the user
  // explicitly asked for that width, so honour it up to DRAG_MAX_WIDTH.
  const width =
    widthOverride != null
      ? Math.max(MIN_WIDTH, Math.min(DRAG_MAX_WIDTH, Math.round(widthOverride)))
      : algorithmic;

  // --- Height measurement ------------------------------------------------
  if (collapsed) {
    return { width, height: HEADER_HEIGHT };
  }
  const hasSubtitle = !!(table.comment && table.comment.trim());
  const subtitleBlock = hasSubtitle ? SUBTITLE_HEIGHT + SUBTITLE_BORDER : 0;
  let rowsHeight = 0;
  for (const col of table.columns) {
    rowsHeight += ROW_BORDER + FIELD_ROW_HEIGHT;
    if (display.showComment && col.comment) rowsHeight += COMMENT_LINE_HEIGHT;
  }
  if (table.columns.length === 0) rowsHeight = ROW_BORDER + FIELD_ROW_HEIGHT;
  const height = HEADER_HEIGHT + subtitleBlock + rowsHeight + 4;
  return { width, height };
}

/**
 * Pre-compute the vertical offset (from the top of the card) of each column's
 * row baseline. With variable per-column heights (comment lines stretch a
 * row), we can no longer derive this from `rowIdx * ROW_HEIGHT`; the canvas
 * needs an exact table to compute per-field FK endpoints.
 */
export function columnRowOffsets(table: Table, display: BuildDisplayOpts): number[] {
  const hasSubtitle = !!(table.comment && table.comment.trim());
  let cursor = HEADER_HEIGHT + (hasSubtitle ? SUBTITLE_HEIGHT + SUBTITLE_BORDER : 0);
  const offsets: number[] = [];
  for (const col of table.columns) {
    // Skip past this column's top border before measuring its content row.
    cursor += ROW_BORDER;
    // Center of the name+type row.
    offsets.push(cursor + FIELD_ROW_HEIGHT / 2);
    cursor += FIELD_ROW_HEIGHT;
    if (display.showComment && col.comment) cursor += COMMENT_LINE_HEIGHT;
  }
  return offsets;
}

/**
 * Build the set of (table, column) pairs that act as an FK source in the
 * given effective FK list. Used so the card can render an "FK" badge next to
 * the right columns without having to scan the FK list per-row at render time.
 */
export function buildFkSourceColumns(fks: ForeignKey[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const fk of fks) {
    let set = map.get(fk.fromTable);
    if (!set) {
      set = new Set();
      map.set(fk.fromTable, set);
    }
    for (const c of fk.fromColumns) set.add(c);
  }
  return map;
}

export function buildElements(
  schema: Schema,
  fks: ForeignKey[],
  opts: BuildOptions,
): BuiltElements {
  const { modules, collapsed, tableWidths, display, decisions } = opts;
  const elements: ElementDefinition[] = [];

  for (const table of schema.tables) {
    const isCollapsed = !!collapsed[table.name];
    const moduleKey = modules.byTable.get(table.name) ?? '';
    const { width, height } = tableBoxSize(
      table,
      isCollapsed,
      display,
      moduleKey,
      tableWidths[table.name],
    );
    const color = colorForTableModule(table.name, modules.byTable, modules.modules);
    elements.push({
      group: 'nodes',
      data: {
        id: nodeId(table.name),
        type: 'table',
        rawName: table.name,
        moduleKey,
        moduleColor: color.header,
        boxWidth: width,
        boxHeight: height,
      },
    });
  }

  // Index lookups for column→row index (used for per-field edge endpoints).
  const tableByName = new Map(schema.tables.map((t) => [t.name, t] as const));

  // Stable per-edge key for manual-route overrides. canonicalFkKey is stable
  // across rebuilds (unlike the index-prefixed `id`); on the rare collision
  // (duplicate column-pair) we disambiguate with the build index.
  const seenFkKeys = new Set<string>();

  for (const [i, fk] of fks.entries()) {
    const fromMod = modules.byTable.get(fk.fromTable);
    const toMod = modules.byTable.get(fk.toTable);
    const sameModule = !!fromMod && fromMod === toMod;
    // Edge color follows the SOURCE table's module: an FK is a property of the
    // referencing table (it "carries" the foreign reference), so reading the
    // diagram from the FK column outward, the line should match the card it
    // leaves rather than the card it lands on. This also keeps all FKs that
    // originate from the same table visually consistent.
    const color = colorForTableModule(fk.fromTable, modules.byTable, modules.modules).header;

    const srcTable = tableByName.get(fk.fromTable);
    const tgtTable = tableByName.get(fk.toTable);
    const srcRowIdx = srcTable?.columns.findIndex((c) => c.name === fk.fromColumns[0]) ?? -1;
    const tgtRowIdx = tgtTable?.columns.findIndex((c) => c.name === fk.toColumns[0]) ?? -1;
    // Solid iff: explicitly declared in DDL, OR user accepted this inferred FK.
    // Everything else (inferred + not yet decided, regardless of confidence) is
    // rendered dashed. Once accepted via the InferencePanel it turns solid.
    const baseKey = fkKey(fk);
    const accepted = fk.source === 'explicit' || decisions[baseKey] === 'accept';
    const lineStyle: 'solid' | 'dashed' = accepted ? 'solid' : 'dashed';
    const edgeFkKey = seenFkKeys.has(baseKey) ? `${baseKey}#${i}` : baseKey;
    seenFkKeys.add(baseKey);

    elements.push({
      group: 'edges',
      data: {
        id: `e_${i}_${fk.fromTable}_${fk.fromColumns.join('-')}__${fk.toTable}`,
        fkKey: edgeFkKey,
        source: nodeId(fk.fromTable),
        target: nodeId(fk.toTable),
        confidence: fk.source === 'explicit' ? 'high' : (fk.confidence ?? 'medium'),
        lineStyle,
        color,
        // Dark-canvas-safe variant of `color`: dark palette hues (mono, earth,
        // darker vibrant) are lifted to a visible lightness. The canvas swaps
        // to this in dark mode; light-mode + light exports keep `color`.
        colorDark: darkEdgeColor(color),
        crossModule: sameModule ? 'no' : 'yes',
        srcRowIdx,
        tgtRowIdx,
        // Initial placeholder endpoints; DiagramCanvas overrides these with
        // exact `<x>px <y>px` strings once layout is known so the edge lands
        // on the actual column row, not just the card edge.
        srcEndpoint: 'outside-to-node',
        tgtEndpoint: 'outside-to-node',
        // Two-bend segment placeholders so the `segments` curve-style has
        // valid data on first render before DiagramCanvas computes real
        // bends. '0.5' / '0' yields a degenerate straight line.
        segWeights: '0.5 0.5',
        segDistances: '0 0',
        meta: {
          source: fk.source,
          reason: fk.reason,
          fromColumns: fk.fromColumns,
          toColumns: fk.toColumns,
        },
      },
      classes: sameModule ? 'same-module' : 'cross-module',
    });
  }

  return { elements };
}

export function nodeId(tableName: string): string {
  return 't:' + tableName.toLowerCase();
}

/** Convenience for FK lookups: a "table.column" key. */
export function fieldKey(table: string, col: string): string {
  return `${table}::${col}`;
}

/** Returns the badge text for a single column (PK > U > I), excluding FK. */
export function columnRoleBadge(col: Column, table: Table, showIndex: boolean): string {
  if (col.isPrimaryKey || table.primaryKey.includes(col.name)) return 'PK';
  if (col.isUnique) return 'U';
  if (col.hasIndex && showIndex) return 'I';
  return '';
}

export const _NODE_METRICS = { ROW_HEIGHT, HEADER_HEIGHT };
