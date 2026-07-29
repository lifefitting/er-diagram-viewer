import type { AppState, WorkspaceGroup } from './types';

/**
 * Persisted-state migration + shape validation for the `persist` middleware.
 *
 * Two hooks, two jobs (zustand v4 semantics):
 *   - `migratePersisted` runs ONLY on a version mismatch (`stored !== current`).
 *     A pre-v2 snapshot used a different `decisions` key scheme (case-preserving,
 *     since canonicalised in v2) and may predate today's layout shapes, so we
 *     drop everything except `rawSql` — the user's script survives and `reparse`
 *     rebuilds the rest.
 *   - `sanitizePersisted` runs on EVERY load (wired as `merge`), so it also
 *     catches shape drift UNDER THE SAME version — the case `migrate` can't see.
 *     Each field is validated independently; a malformed field is dropped (so
 *     the slice default is used) rather than loaded blind (which would mis-place
 *     cards or push the camera off-screen until 重置布局).
 *
 * Intentionally dependency-free (no schema lib) to keep the bundle lean.
 */

type Persisted = Partial<AppState>;

/** Bump when the persisted shape changes in a breaking way; older snapshots
 *  are dropped on load instead of producing runtime errors.
 *  v2: `decisions` keys switched to canonical (case-insensitive) form via
 *      `canonicalFkKey`. Previous v1 decisions were case-preserving and
 *      would silently fail to apply after the change.
 *  Lives here (not store/index.ts) so pure consumers — the persist config AND
 *  the workspace-archive format — share one source of truth without pulling in
 *  the zustand store instance. */
export const PERSIST_VERSION = 2;

const PALETTES = new Set(['professional', 'vibrant', 'pastel', 'earth', 'mono']);
const THEMES = new Set(['light', 'dark', 'system']);

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPt(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    isFiniteNum((v as { x: unknown }).x) &&
    isFiniteNum((v as { y: unknown }).y)
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Record<string, {x,y}> with finite coords. */
function isNodePositions(o: unknown): boolean {
  return isRecord(o) && Object.values(o).every(isPt);
}

/** Record<string, {x,y}[]> with finite coords. */
function isManualRoutes(o: unknown): boolean {
  return isRecord(o) && Object.values(o).every((v) => Array.isArray(v) && v.every(isPt));
}

/** A persisted manual FK: `source: 'manual'` plus non-empty table/column
 *  names. `kind` is optional (absent = physical fk) but must be a known value
 *  when present. */
function isManualFk(v: unknown): boolean {
  if (!isRecord(v) || v.source !== 'manual') return false;
  if (typeof v.fromTable !== 'string' || v.fromTable.length === 0) return false;
  if (typeof v.toTable !== 'string' || v.toTable.length === 0) return false;
  if (v.kind !== undefined && v.kind !== 'fk' && v.kind !== 'logical') return false;
  if (v.drawSide !== undefined && v.drawSide !== 'left' && v.drawSide !== 'right') return false;
  const cols = (c: unknown) =>
    Array.isArray(c) && c.length > 0 && c.every((n) => typeof n === 'string' && n.length > 0);
  return cols(v.fromColumns) && cols(v.toColumns);
}

/** {x,y,zoom} with finite numbers. */
function isViewport(o: unknown): boolean {
  return (
    isRecord(o) &&
    isFiniteNum(o.x) &&
    isFiniteNum(o.y) &&
    isFiniteNum((o as { zoom: unknown }).zoom)
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isWorkspaceGroups(v: unknown): v is WorkspaceGroup[] {
  if (!Array.isArray(v)) return false;
  const ids = new Set<string>();
  for (const item of v) {
    if (!isRecord(item)) return false;
    if (typeof item.id !== 'string' || item.id.length === 0 || ids.has(item.id)) return false;
    if (typeof item.label !== 'string' || item.label.length === 0) return false;
    if (typeof item.sourceFile !== 'string' || item.sourceFile.length === 0) return false;
    if (!isStringArray(item.nodeIds) || !isStringArray(item.logicalKeys)) return false;
    if (!PALETTES.has(item.palette as string)) return false;
    if (item.viewport !== null && !isViewport(item.viewport)) return false;
    if (!isPt(item.translation)) return false;
    ids.add(item.id);
  }
  return true;
}

/**
 * Keep only the persisted fields that pass shape validation; drop the rest so
 * the store falls back to its slice defaults. Returns a fresh object safe to
 * shallow-merge over the initial state.
 */
export function sanitizePersisted(raw: unknown): Persisted {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};

  if (typeof raw.rawSql === 'string') out.rawSql = raw.rawSql;
  if (PALETTES.has(raw.palette as string)) out.palette = raw.palette;
  if (THEMES.has(raw.theme as string)) out.theme = raw.theme;
  if (typeof raw.sidebarCollapsed === 'boolean') out.sidebarCollapsed = raw.sidebarCollapsed;

  if (
    isRecord(raw.decisions) &&
    Object.values(raw.decisions).every((v) => v === 'accept' || v === 'reject')
  )
    out.decisions = raw.decisions;
  if (Array.isArray(raw.manualFks) && raw.manualFks.every(isManualFk))
    out.manualFks = raw.manualFks;
  if (
    Array.isArray(raw.logicalKeys) &&
    raw.logicalKeys.every((k) => typeof k === 'string' && k.length > 0)
  )
    out.logicalKeys = raw.logicalKeys;
  if (isRecord(raw.fieldNotes)) {
    // Two generations of legacy shapes upgrade in place: plain-string values
    // (pre-timestamp) and {text, updatedAt} objects (pre-severity/status) —
    // both land on the defaults 建议 (suggest) / 待处理 (open).
    const SEVERITIES = new Set(['suggest', 'warn', 'block']);
    const STATUSES = new Set(['open', 'accepted', 'rejected']);
    const notes: Record<
      string,
      { text: string; updatedAt: string; severity: string; status: string }
    > = {};
    let valid = true;
    for (const [k, v] of Object.entries(raw.fieldNotes)) {
      if (typeof v === 'string' && v.length > 0) {
        notes[k] = { text: v, updatedAt: '', severity: 'suggest', status: 'open' };
      } else if (
        isRecord(v) &&
        typeof v.text === 'string' &&
        v.text.length > 0 &&
        (v.updatedAt === undefined || typeof v.updatedAt === 'string') &&
        (v.severity === undefined || SEVERITIES.has(v.severity as string)) &&
        (v.status === undefined || STATUSES.has(v.status as string))
      ) {
        notes[k] = {
          text: v.text,
          updatedAt: (v.updatedAt as string) ?? '',
          severity: (v.severity as string) ?? 'suggest',
          status: (v.status as string) ?? 'open',
        };
      } else {
        valid = false;
        break;
      }
    }
    if (valid) out.fieldNotes = notes;
  }

  if (
    isRecord(raw.display) &&
    ['onlyPk', 'showType', 'showComment', 'showIndex', 'showLowConfidence'].every(
      (k) => typeof (raw.display as Record<string, unknown>)[k] === 'boolean',
    )
  )
    // Later-added visibility toggles default ON for snapshots predating them
    // (the shallow store merge would otherwise leave them undefined = hidden).
    out.display = { showLogicalLinks: true, showManualLinks: true, ...raw.display };

  if (isRecord(raw.collapsed) && Object.values(raw.collapsed).every((v) => typeof v === 'boolean'))
    out.collapsed = raw.collapsed;
  if (isRecord(raw.tableWidths) && Object.values(raw.tableWidths).every(isFiniteNum))
    out.tableWidths = raw.tableWidths;
  if (isRecord(raw.deletedTables)) {
    // Legacy snapshots stored `true`; retain the decision with an unknown time.
    const decisions: Record<string, { action: 'delete'; updatedAt: string }> = {};
    let valid = true;
    for (const [key, value] of Object.entries(raw.deletedTables)) {
      if (value === true) decisions[key] = { action: 'delete', updatedAt: '' };
      else if (isRecord(value) && value.action === 'delete' && typeof value.updatedAt === 'string')
        decisions[key] = { action: 'delete', updatedAt: value.updatedAt };
      else {
        valid = false;
        break;
      }
    }
    if (valid) out.deletedTables = decisions;
  }
  if (isNodePositions(raw.nodePositions)) out.nodePositions = raw.nodePositions;
  if (isManualRoutes(raw.manualRoutes)) out.manualRoutes = raw.manualRoutes;
  if (raw.viewport === null || isViewport(raw.viewport)) out.viewport = raw.viewport;
  if (isWorkspaceGroups(raw.workspaceGroups)) out.workspaceGroups = raw.workspaceGroups;

  return out as Persisted;
}

/**
 * `migrate` hook: only invoked on a version mismatch. A pre-current snapshot has
 * an incompatible `decisions` key scheme (and possibly stale layout shapes), so
 * keep just `rawSql` and let everything else rebuild from defaults. `merge`
 * (`sanitizePersisted`) then validates the result. Returns a partial state; the
 * persist middleware passes it on to `merge`.
 */
export function migratePersisted(persisted: unknown, _version: number): Persisted {
  if (!isRecord(persisted)) return {};
  return { rawSql: typeof persisted.rawSql === 'string' ? persisted.rawSql : '' };
}
