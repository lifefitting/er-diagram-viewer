import type { StateCreator } from 'zustand';
import type { AppState, DisplayState } from './types';

/** Field-display toggles, layout algorithm, search box. */
export const createDisplaySlice: StateCreator<AppState, [], [], DisplayState> = (set) => ({
  display: {
    onlyPk: false,
    showType: true,
    showComment: true,
    showIndex: true,
    showLowConfidence: false,
  },
  layout: 'fcose',
  search: '',
  // Default to `system` so first-time visitors get whatever their OS prefers.
  // Persisted; once the user picks light/dark explicitly we honor that.
  theme: 'system',
  setLayout(l) {
    set({ layout: l });
  },
  setSearch(s) {
    set({ search: s });
  },
  toggleDisplay(k) {
    set((s) => ({ display: { ...s.display, [k]: !s.display[k] } }));
  },
  setTheme(t) {
    set({ theme: t });
  },
});
