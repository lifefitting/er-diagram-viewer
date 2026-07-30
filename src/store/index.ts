import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createSchemaSlice } from './schemaSlice';
import { createDecisionsSlice } from './decisionsSlice';
import { createDisplaySlice } from './displaySlice';
import { createCanvasSlice } from './canvasSlice';
import { createHistorySlice } from './historySlice';
import { createNotesSlice } from './notesSlice';
import { migratePersisted, sanitizePersisted, PERSIST_VERSION } from './persistMigrate';

export type { AppState, DisplayOptions } from './types';
export { effectiveForeignKeys, visibleSchema } from './selectors';

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
  'searchScope',
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
  // Canvas remount counter for archive imports — an in-page mechanism only;
  // rehydrating it would be meaningless (and harmless, but noisy).
  'workspaceEpoch',
] as const satisfies ReadonlyArray<keyof AppState>;

type PersistedAppState = Omit<AppState, (typeof DERIVED_OR_TRANSIENT_FIELDS)[number]>;

/** The persisted subset of a state object: denylisted fields and action
 *  functions stripped. Shared by the persist middleware's `partialize` and the
 *  workspace-archive export, so the archive format automatically tracks
 *  whatever the app persists. */
function pickPersisted(state: AppState): PersistedAppState {
  const out: Partial<AppState> = { ...state };
  for (const k of DERIVED_OR_TRANSIENT_FIELDS) delete out[k];
  // Strip the action function values too — zustand re-injects them on hydration.
  for (const key of Object.keys(out) as (keyof AppState)[]) {
    if (typeof out[key] === 'function') delete out[key];
  }
  return out as PersistedAppState;
}

/** Live snapshot of the persisted subset (for the 工作区存档 export). */
export function getPersistedSnapshot(): PersistedAppState {
  return pickPersisted(useApp.getState());
}

export const useApp = create<AppState>()(
  persist(
    (...a) => ({
      ...createSchemaSlice(...a),
      ...createDecisionsSlice(...a),
      ...createDisplaySlice(...a),
      ...createCanvasSlice(...a),
      ...createHistorySlice(...a),
      ...createNotesSlice(...a),
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => sessionStorage),
      partialize: pickPersisted,
      // Runs ONLY on a version mismatch: drop an incompatible old snapshot down
      // to its rawSql (see persistMigrate). `merge` then validates the result.
      migrate: (persisted, version) => ({
        ...(migratePersisted(persisted, version) as Partial<AppState>),
      }),
      // Runs on EVERY load: validate each persisted field's shape and drop the
      // malformed ones (falling back to slice defaults) before shallow-merging
      // over the initial state. This catches shape drift under the SAME version,
      // which `migrate` never sees. Valid state passes through unchanged, so the
      // normal restore path is identical to zustand's default shallow merge.
      merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted) }) as AppState,
      // After hydration, `schema` is still null. The App-level mount effect
      // calls `reparse()` to repopulate the derived data; we don't do it
      // here to avoid races with React's initial render cycle.
    },
  ),
);
