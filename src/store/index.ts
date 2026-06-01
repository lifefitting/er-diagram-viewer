import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createSchemaSlice } from './schemaSlice';
import { createDecisionsSlice } from './decisionsSlice';
import { createDisplaySlice } from './displaySlice';
import { createCanvasSlice } from './canvasSlice';
import { createHistorySlice } from './historySlice';

export type { AppState, DisplayOptions } from './types';
export { effectiveForeignKeys, visibleSchema } from './selectors';

/** Bump when the persisted shape changes in a breaking way; older snapshots
 *  are dropped on load instead of producing runtime errors.
 *  v2: `decisions` keys switched to canonical (case-insensitive) form via
 *      `canonicalFkKey`. Previous v1 decisions were case-preserving and
 *      would silently fail to apply after the change. */
const PERSIST_VERSION = 2;

/** sessionStorage key — namespaced so we can ship multiple persist stores
 *  later (e.g. user prefs vs current schema) without collision.
 *
 *  Why sessionStorage rather than localStorage: imported DDL may contain
 *  real production schema. sessionStorage survives page refresh (the only
 *  persistence the user actually asked for) but is cleared when the tab
 *  closes, so the SQL is not left sitting on disk indefinitely. */
const PERSIST_KEY = 'er-viewer:state:v1';

/**
 * Fields the persist middleware should NOT save. Denylist-mode is safer than
 * the previous allowlist: adding a new persisted preference no longer
 * requires touching this list, only adding derived/transient fields does.
 *
 * Derived state (`schema` / `inferred` / `modules`) is rebuilt from `rawSql`
 * on hydration by the App-level startup effect calling `reparse()`. Persisting
 * it would bloat sessionStorage AND require (de)serializing the Maps inside
 * `ModulesResult`.
 *
 * Transient state (`flashTables` / `flashTick`) belongs only to the in-page
 * animation; reloading should not re-fire a stale flash.
 */
const DERIVED_OR_TRANSIENT_FIELDS = [
  'schema',
  'inferred',
  'modules',
  'flashTables',
  'flashTick',
  'search',
  // Search match navigation is derived from `search` + the live canvas; the
  // canvas repopulates it on load, so persisting it would only rehydrate a
  // stale counter.
  'searchMatchIds',
  'searchActiveIndex',
  'pendingSearchStep',
  // canUndo/canRedo mirror the in-module snapshot stacks (cyHandle), which are
  // session-only and empty after reload — persisting them would rehydrate the
  // buttons as stale-enabled. canvasMode resets to 'select' on a fresh tab.
  'canUndo',
  'canRedo',
  'canvasMode',
] as const satisfies ReadonlyArray<keyof AppState>;

type PersistedAppState = Omit<AppState, (typeof DERIVED_OR_TRANSIENT_FIELDS)[number]>;

export const useApp = create<AppState>()(
  persist(
    (...a) => ({
      ...createSchemaSlice(...a),
      ...createDecisionsSlice(...a),
      ...createDisplaySlice(...a),
      ...createCanvasSlice(...a),
      ...createHistorySlice(...a),
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => {
        const out: Partial<AppState> = { ...state };
        for (const k of DERIVED_OR_TRANSIENT_FIELDS) delete out[k];
        // Strip the action function values too — zustand re-injects them on hydration.
        for (const key of Object.keys(out) as (keyof AppState)[]) {
          if (typeof out[key] === 'function') delete out[key];
        }
        return out as PersistedAppState;
      },
      // After hydration, `schema` is still null. The App-level mount effect
      // calls `reparse()` to repopulate the derived data; we don't do it
      // here to avoid races with React's initial render cycle.
    },
  ),
);
