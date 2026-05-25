import type { StateCreator } from 'zustand';
import type { AppState, DecisionsState } from './types';

/** Accept/reject decisions on inferred FKs, with batch helpers. */
export const createDecisionsSlice: StateCreator<AppState, [], [], DecisionsState> = (set) => ({
  decisions: {},
  acceptFk(key) {
    set((s) => ({ decisions: { ...s.decisions, [key]: 'accept' } }));
  },
  rejectFk(key) {
    set((s) => ({ decisions: { ...s.decisions, [key]: 'reject' } }));
  },
  batchDecide(keys, decision) {
    if (keys.length === 0) return;
    set((s) => {
      const next = { ...s.decisions };
      for (const k of keys) next[k] = decision;
      return { decisions: next };
    });
  },
  batchClear(keys) {
    if (keys.length === 0) return;
    set((s) => {
      const next = { ...s.decisions };
      let changed = false;
      for (const k of keys) {
        if (k in next) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? { decisions: next } : {};
    });
  },
  resetDecisions() {
    set({ decisions: {} });
  },
});
