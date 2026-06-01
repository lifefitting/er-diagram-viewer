import type { AppState } from './types';

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

const PALETTES = new Set(['vibrant', 'pastel', 'earth', 'mono']);
const THEMES = new Set(['light', 'dark', 'system']);

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPt(v: unknown): boolean {
  return typeof v === 'object' && v !== null && isFiniteNum((v as { x: unknown }).x) && isFiniteNum((v as { y: unknown }).y);
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

/** {x,y,zoom} with finite numbers. */
function isViewport(o: unknown): boolean {
  return (
    isRecord(o) && isFiniteNum(o.x) && isFiniteNum(o.y) && isFiniteNum((o as { zoom: unknown }).zoom)
  );
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

  if (isRecord(raw.decisions) && Object.values(raw.decisions).every((v) => v === 'accept' || v === 'reject'))
    out.decisions = raw.decisions;

  if (
    isRecord(raw.display) &&
    ['onlyPk', 'showType', 'showComment', 'showIndex', 'showLowConfidence'].every(
      (k) => typeof (raw.display as Record<string, unknown>)[k] === 'boolean',
    )
  )
    out.display = raw.display;

  if (isRecord(raw.collapsed) && Object.values(raw.collapsed).every((v) => typeof v === 'boolean'))
    out.collapsed = raw.collapsed;
  if (isRecord(raw.tableWidths) && Object.values(raw.tableWidths).every(isFiniteNum))
    out.tableWidths = raw.tableWidths;
  if (isRecord(raw.deletedTables) && Object.values(raw.deletedTables).every((v) => v === true))
    out.deletedTables = raw.deletedTables;
  if (isNodePositions(raw.nodePositions)) out.nodePositions = raw.nodePositions;
  if (isManualRoutes(raw.manualRoutes)) out.manualRoutes = raw.manualRoutes;
  if (raw.viewport === null || isViewport(raw.viewport)) out.viewport = raw.viewport;

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
