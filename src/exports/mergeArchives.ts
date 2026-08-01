import type { ForeignKey } from '../parser/types';
import { canonicalFkKey } from '../parser/utils';
import { nodeId } from '../diagram/nodeId';
import { runPipeline } from '../store/pipeline';
import type { AppState, DisplayOptions, FieldNote, Viewport, WorkspaceGroup } from '../store/types';
import type { PaletteName } from '../infer/inferModules';
import type { ParseArchiveResult } from './archive';

type LoadedArchive = Extract<ParseArchiveResult, { ok: true }>;
type Point = { x: number; y: number };
type Bounds = { x1: number; y1: number; x2: number; y2: number };

export interface MergeArchiveSource {
  archive: LoadedArchive;
  fileName: string;
}

export interface MergeArchiveSummary {
  tableCount: number;
  shiftedGroups: number;
  warnings: string[];
}

export type MergeArchivesResult =
  | {
      ok: true;
      state: Partial<AppState> & { rawSql: string; workspaceGroups: WorkspaceGroup[] };
      summary: MergeArchiveSummary;
    }
  | { ok: false; error: string; conflicts: string[] };

// Positions are card centres. Inflate point bounds before collision checks so
// groups whose centres do not overlap still leave room for real card bodies.
const APPROX_CARD_RADIUS = 140;
const GROUP_GAP = 120;

function sourceLabel(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const withoutExt = base.replace(/\.erreview$/i, '');
  const withoutStamp = withoutExt.replace(/-\d{8}-\d{4}$/i, '');
  const withoutWorkspace = withoutStamp.replace(/-workspace$/i, '');
  return withoutWorkspace.replace(/[-_]+/g, ' ').trim() || '工作区';
}

function sourceId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'workspace'}-${index + 1}`;
}

function pointBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  return {
    x1: Math.min(...points.map((point) => point.x)) - APPROX_CARD_RADIUS,
    y1: Math.min(...points.map((point) => point.y)) - APPROX_CARD_RADIUS,
    x2: Math.max(...points.map((point) => point.x)) + APPROX_CARD_RADIUS,
    y2: Math.max(...points.map((point) => point.y)) + APPROX_CARD_RADIUS,
  };
}

function translateBounds(bounds: Bounds, delta: Point): Bounds {
  return {
    x1: bounds.x1 + delta.x,
    y1: bounds.y1 + delta.y,
    x2: bounds.x2 + delta.x,
    y2: bounds.y2 + delta.y,
  };
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/** Find the shortest axis-aligned rigid translation that clears all already
 *  placed workspace bounds. The common case (including both demo archives) is
 *  zero translation. */
function placeBounds(bounds: Bounds | null, placed: readonly Bounds[]): Point {
  if (!bounds || placed.length === 0 || placed.every((other) => !intersects(bounds, other))) {
    return { x: 0, y: 0 };
  }

  const candidates: Point[] = [];
  for (const other of placed) {
    candidates.push(
      { x: other.x2 + GROUP_GAP - bounds.x1, y: 0 },
      { x: other.x1 - GROUP_GAP - bounds.x2, y: 0 },
      { x: 0, y: other.y2 + GROUP_GAP - bounds.y1 },
      { x: 0, y: other.y1 - GROUP_GAP - bounds.y2 },
    );
  }
  const valid = candidates.filter((delta) => {
    const moved = translateBounds(bounds, delta);
    return placed.every((other) => !intersects(moved, other));
  });
  if (valid.length > 0) {
    return valid.reduce((best, candidate) =>
      candidate.x ** 2 + candidate.y ** 2 < best.x ** 2 + best.y ** 2 ? candidate : best,
    );
  }

  const rightEdge = Math.max(...placed.map((item) => item.x2));
  return { x: rightEdge + GROUP_GAP - bounds.x1, y: 0 };
}

function moveViewport(viewport: Viewport | null | undefined, delta: Point): Viewport | null {
  if (!viewport) return null;
  // rendered = model * zoom + pan. Moving every model point by delta requires
  // the inverse pan adjustment to preserve the source archive's exact camera.
  return {
    x: viewport.x - delta.x * viewport.zoom,
    y: viewport.y - delta.y * viewport.zoom,
    zoom: viewport.zoom,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeRecords<T>(
  label: string,
  records: readonly (Record<string, T> | undefined)[],
  conflicts: string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record ?? {})) {
      if (key in out && !sameValue(out[key], value)) conflicts.push(`${label}: ${key}`);
      else out[key] = value;
    }
  }
  return out;
}

function translatePoints(points: readonly Point[], delta: Point): Point[] {
  if (delta.x === 0 && delta.y === 0) return points.map((point) => ({ ...point }));
  return points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
}

/** Merge validated archives without mutating any source state. Every source is
 *  kept as a rigid layout group; inference and logical-key selection remain
 *  scoped to that group after import and after future refresh/reparse cycles. */
export function mergeWorkspaceArchives(
  sources: readonly MergeArchiveSource[],
): MergeArchivesResult {
  if (sources.length < 2) {
    return { ok: false, error: '至少需要两个工作区存档才能合并', conflicts: [] };
  }
  if (sources.some((source) => source.archive.downgraded)) {
    return {
      ok: false,
      error: '旧版本存档已降级为仅 SQL，无法保证原始布局；请先分别用当前版本重新导出',
      conflicts: [],
    };
  }

  const palette = (sources.find((source) => source.archive.state.palette)?.archive.state.palette ??
    'professional') as PaletteName;
  const parsedSources = sources.map((source) => {
    const sourcePalette = (source.archive.state.palette ?? palette) as PaletteName;
    const result = runPipeline(
      source.archive.state.rawSql,
      sourcePalette,
      source.archive.state.logicalKeys ?? [],
    );
    return { ...source, palette: sourcePalette, schema: result.schema };
  });

  // nodeId lowercases table names, so this also catches case-only collisions
  // that would otherwise make two cards and their persisted fields alias.
  const nodeOwners = new Map<string, string>();
  const tableConflicts: string[] = [];
  for (const source of parsedSources) {
    for (const table of source.schema.tables) {
      const id = nodeId(table.name);
      const owner = nodeOwners.get(id);
      if (owner) tableConflicts.push(`${table.name}（${owner} / ${source.fileName}）`);
      else nodeOwners.set(id, source.fileName);
    }
  }
  if (tableConflicts.length > 0) {
    return {
      ok: false,
      error: '存档中存在同名表；当前版本不会静默重命名 SQL 或评审键',
      conflicts: tableConflicts,
    };
  }

  const conflicts: string[] = [];
  const warnings: string[] = [];
  const placed: Bounds[] = [];
  const nodePositions: Record<string, Point> = {};
  const manualRoutes: Record<string, Point[]> = {};
  const moduleOverrides: Record<string, string> = {};
  const workspaceGroups: WorkspaceGroup[] = [];

  parsedSources.forEach((source, index) => {
    const ids = source.schema.tables.map((table) => nodeId(table.name));
    const idSet = new Set(ids);
    const saved = source.archive.state.nodePositions ?? {};
    const sourcePositions = Object.entries(saved).filter(([id]) => idSet.has(id));
    const bounds = pointBounds(sourcePositions.map(([, point]) => point));
    const delta = placeBounds(bounds, placed);
    if (bounds) placed.push(translateBounds(bounds, delta));
    if (delta.x !== 0 || delta.y !== 0) {
      warnings.push(`${sourceLabel(source.fileName)} 整体平移 (${delta.x}, ${delta.y}) 以避让重叠`);
    }
    if (sourcePositions.length !== ids.length) {
      warnings.push(
        `${sourceLabel(source.fileName)} 有 ${ids.length - sourcePositions.length} 张表缺少保存位置，将由画布放置`,
      );
    }

    for (const [id, point] of sourcePositions)
      nodePositions[id] = translatePoints([point], delta)[0];
    for (const [key, points] of Object.entries(source.archive.state.manualRoutes ?? {})) {
      if (key in manualRoutes && !sameValue(manualRoutes[key], points)) {
        conflicts.push(`手工路由: ${key}`);
      } else {
        manualRoutes[key] = translatePoints(points, delta);
      }
    }

    const label = sourceLabel(source.fileName);
    const groupId = sourceId(label, index);
    // The merged pipeline scopes every inferred module key by workspace id.
    // Carry explicit assignments through the same transformation so a user's
    // corrected grouping survives archive merge as well as plain import.
    for (const [id, targetKey] of Object.entries(source.archive.state.moduleOverrides ?? {})) {
      if (idSet.has(id)) moduleOverrides[id] = `${groupId}:${targetKey}`;
    }
    workspaceGroups.push({
      id: groupId,
      label,
      sourceFile: source.fileName,
      nodeIds: ids,
      logicalKeys: [...(source.archive.state.logicalKeys ?? [])],
      palette: source.palette,
      viewport: moveViewport(source.archive.state.viewport, delta),
      translation: delta,
    });
  });

  const decisions = mergeRecords(
    '关系决策',
    parsedSources.map((source) => source.archive.state.decisions),
    conflicts,
  );
  const collapsed = mergeRecords(
    '折叠状态',
    parsedSources.map((source) => source.archive.state.collapsed),
    conflicts,
  );
  const tableWidths = mergeRecords(
    '表宽',
    parsedSources.map((source) => source.archive.state.tableWidths),
    conflicts,
  );
  const columnOrders = mergeRecords(
    '字段顺序',
    parsedSources.map((source) => source.archive.state.columnOrders),
    conflicts,
  );
  const deletedTables = mergeRecords(
    '回收站',
    parsedSources.map((source) => source.archive.state.deletedTables),
    conflicts,
  );
  const fieldNotes = mergeRecords<FieldNote>(
    '字段批注',
    parsedSources.map((source) => source.archive.state.fieldNotes),
    conflicts,
  );

  const manualByKey = new Map<string, ForeignKey>();
  for (const source of parsedSources) {
    for (const fk of source.archive.state.manualFks ?? []) {
      const key = canonicalFkKey(fk);
      const existing = manualByKey.get(key);
      if (existing && !sameValue(existing, fk)) conflicts.push(`手工关系: ${key}`);
      else manualByKey.set(key, { ...fk });
    }
  }
  if (conflicts.length > 0) {
    return { ok: false, error: '存档包含无法安全自动解决的状态冲突', conflicts };
  }

  const displays = parsedSources
    .map((source) => source.archive.state.display)
    .filter((display): display is DisplayOptions => display !== undefined);
  if (displays.some((display) => !sameValue(display, displays[0]))) {
    warnings.push('显示选项不同，合并后采用第一个存档的设置');
  }
  if (new Set(parsedSources.map((source) => source.palette)).size > 1) {
    warnings.push('调色板不同；首次导入保留各工作区配色，之后手动切换将统一全部工作区');
  }

  // A semicolon on its own line safely separates archives even when the first
  // SQL text ends in a line comment or lacks a trailing statement delimiter.
  const rawSql = parsedSources.map((source) => source.archive.state.rawSql.trimEnd()).join('\n;\n');
  const state: Partial<AppState> & { rawSql: string; workspaceGroups: WorkspaceGroup[] } = {
    rawSql,
    palette,
    logicalKeys: [],
    moduleOverrides,
    workspaceGroups,
    decisions,
    manualFks: [...manualByKey.values()],
    fieldNotes,
    collapsed,
    tableWidths,
    columnOrders,
    nodePositions,
    manualRoutes,
    deletedTables,
    viewport: null,
    ...(displays[0] ? { display: displays[0] } : {}),
  };

  // Final pre-flight uses the exact scoped pipeline the imported store will
  // use, catching any concatenation/parser drift before current state changes.
  const merged = runPipeline(rawSql, palette, [], workspaceGroups, moduleOverrides);
  const expectedIds = new Set(workspaceGroups.flatMap((group) => group.nodeIds));
  const actualIds = new Set(merged.schema.tables.map((table) => nodeId(table.name)));
  if (expectedIds.size !== actualIds.size || [...expectedIds].some((id) => !actualIds.has(id))) {
    return {
      ok: false,
      error: '合并 SQL 后的表集合与源存档不一致，已取消导入以保护当前工作区',
      conflicts: [],
    };
  }

  return {
    ok: true,
    state,
    summary: {
      tableCount: merged.schema.tables.length,
      shiftedGroups: workspaceGroups.filter(
        (group) => group.translation.x !== 0 || group.translation.y !== 0,
      ).length,
      warnings,
    },
  };
}
