import type { StateCreator } from 'zustand';
import type { AppState, HistoryState } from './types';
import { undo as cyUndo, redo as cyRedo } from '../diagram/cyHandle';

/**
 * Reactive undo/redo enablement. The buttons subscribe to `canUndo`/`canRedo`
 * so they grey correctly; the `undo`/`redo` actions delegate to the snapshot
 * machinery in `diagram/cyHandle`, which calls `setHistoryFlags` back to keep
 * the booleans in sync. The stacks themselves live in cyHandle (session-only,
 * never persisted). cyHandle has no static cytoscape import, so importing from
 * it here does not pull cytoscape into the main bundle.
 */
export const createHistorySlice: StateCreator<AppState, [], [], HistoryState> = (set) => ({
  canUndo: false,
  canRedo: false,
  undo() {
    cyUndo();
  },
  redo() {
    cyRedo();
  },
  setHistoryFlags(canUndo, canRedo) {
    set({ canUndo, canRedo });
  },
});
