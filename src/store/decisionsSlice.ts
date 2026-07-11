import type { StateCreator } from 'zustand';
import { canonicalFkKey } from '../parser/utils';
import type { AppState, DecisionsState } from './types';

/** Accept/reject decisions on inferred FKs, plus user-added manual FKs. */
export const createDecisionsSlice: StateCreator<AppState, [], [], DecisionsState> = (set, get) => ({
  decisions: {},
  manualFks: [],
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
  addManualFk(fk) {
    // The drawn direction is stored verbatim; logical keys are already
    // order-normalized inside canonicalFkKey, so the reverse of an existing
    // logical link still collides here.
    const next = { ...fk, source: 'manual' as const };
    const key = canonicalFkKey(next);
    // Reject a key collision with ANY other FK — explicit, inferred (even
    // rejected/hidden ones, since visibility toggles must not change collision
    // counts; see the route-key invariant in buildGraph), or manual. This keeps
    // every manual FK's route key stable and bare.
    const s = get();
    const taken = new Set<string>([
      ...(s.schema?.explicitForeignKeys ?? []).map(canonicalFkKey),
      ...s.inferred.map(canonicalFkKey),
      ...s.manualFks.map(canonicalFkKey),
    ]);
    if (taken.has(key)) return;
    set({ manualFks: [...s.manualFks, next] });
  },
  removeManualFk(key) {
    set((s) => ({ manualFks: s.manualFks.filter((fk) => canonicalFkKey(fk) !== key) }));
  },
  setManualFkKind(key, kind) {
    const s = get();
    const idx = s.manualFks.findIndex((fk) => canonicalFkKey(fk) === key);
    if (idx < 0) return null;
    const cur = s.manualFks[idx];
    if ((cur.kind ?? 'fk') === kind) return null;
    // Endpoints stay in the DRAWN direction: flipping 逻辑→物理 must produce
    // "drag start references drag end", exactly as the user connected it.
    const next = {
      ...cur,
      kind,
      reason: kind === 'logical' ? '用户手动添加（业务键逻辑关联）' : '用户手动添加',
    };
    // The kind participates in key normalization (logical keys are unordered),
    // so the canonical key may change — guard it against every other
    // relation's key (same invariant as add).
    const newKey = canonicalFkKey(next);
    if (newKey !== key) {
      const taken = new Set<string>([
        ...(s.schema?.explicitForeignKeys ?? []).map(canonicalFkKey),
        ...s.inferred.map(canonicalFkKey),
        ...s.manualFks.filter((_, i) => i !== idx).map(canonicalFkKey),
      ]);
      if (taken.has(newKey)) return '同路径已存在其他关系，无法切换类型';
    }
    const manualFks = s.manualFks.slice();
    manualFks[idx] = next;
    set({ manualFks });
    return null;
  },
});
