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
    const cur = get().searchMatchIds;
    const same = cur.length === ids.length && cur.every((v, i) => v === ids[i]);
    if (same) return; // identity-stable no-op so the centering effect doesn't refire
    set({ searchMatchIds: ids, searchActiveIndex: -1 });
  },
  cycleSearchMatch(dir) {
    set((s) => ({
      searchActiveIndex: nextMatchIndex(s.searchActiveIndex, s.searchMatchIds.length, dir),
    }));
  },
});
