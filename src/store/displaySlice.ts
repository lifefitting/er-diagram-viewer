import type { StateCreator } from 'zustand';
import type { AppState, DisplayState } from './types';
import { nextMatchIndex } from './searchNav';

/** Field-display toggles, search box (+ find-style match navigation), theme. */
export const createDisplaySlice: StateCreator<AppState, [], [], DisplayState> = (set, get) => ({
  display: {
    onlyPk: false,
    showType: true,
    showComment: true,
    showIndex: true,
    showLowConfidence: false,
  },
  search: '',
  searchMatchIds: [],
  searchActiveIndex: -1,
  pendingSearchStep: null,
  // Default to `system` so first-time visitors get whatever their OS prefers.
  // Persisted; once the user picks light/dark explicitly we honor that.
  theme: 'system',
  setSearch(s) {
    // A new query invalidates the match cursor; the canvas re-derives the match
    // list and pushes it back via setSearchMatches.
    set({ search: s, searchActiveIndex: -1 });
  },
  toggleDisplay(k) {
    set((s) => ({ display: { ...s.display, [k]: !s.display[k] } }));
  },
  setTheme(t) {
    set({ theme: t });
  },
  setSearchMatches(ids) {
    const { searchMatchIds: cur, searchActiveIndex, pendingSearchStep } = get();
    const sameOrder = cur.length === ids.length && cur.every((v, i) => v === ids[i]);
    // Identity-stable no-op so the follow/centering effects don't refire — but
    // never skip when a deferred Enter-step is waiting to be applied.
    if (sameOrder && pendingSearchStep == null) return;
    let nextActive: number;
    if (pendingSearchStep != null) {
      // Deferred Enter on a freshly-typed query: step in from the top/bottom now
      // that the recomputed match list has arrived.
      nextActive = nextMatchIndex(-1, ids.length, pendingSearchStep);
    } else {
      // Pure reorder (e.g. the user dragged a matched card): keep the cursor on
      // the same node if it's still a match; otherwise (the match SET changed —
      // a new query) reset to "not stepped in". setSearch already cleared the
      // index on a query change, so this only preserves it across a reorder.
      const activeId = searchActiveIndex >= 0 ? cur[searchActiveIndex] : null;
      nextActive = activeId != null ? ids.indexOf(activeId) : -1;
    }
    set({ searchMatchIds: ids, searchActiveIndex: nextActive, pendingSearchStep: null });
  },
  cycleSearchMatch(dir) {
    set((s) => ({
      searchActiveIndex: nextMatchIndex(s.searchActiveIndex, s.searchMatchIds.length, dir),
    }));
  },
  requestSearchStep(dir) {
    set({ pendingSearchStep: dir });
  },
});
