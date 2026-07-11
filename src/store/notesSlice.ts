import type { StateCreator } from 'zustand';
import type { AppState, NotesState } from './types';

/** Stable key for a field-level review note. Case-preserving — table/column
 *  names come from the parsed schema, so they're already canonical. */
export function fieldNoteKey(table: string, column: string): string {
  return `${table}::${column}`;
}

/** Split a `table::column` note key back into its parts (null if malformed). */
export function parseFieldNoteKey(key: string): { table: string; column: string } | null {
  const i = key.indexOf('::');
  if (i < 0) return null;
  return { table: key.slice(0, i), column: key.slice(i + 2) };
}

/** `2026-07-11T18:30:00.000Z` → `07-11 18:30` (local time); '' if invalid. */
export function formatNoteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Field-level review annotations (评审批注): click a field row on the canvas →
 * write why it's problematic (naming, type, redundancy, …) in the bubble.
 * Each note records WHEN it was written (part of the review record). Notes are
 * persisted (a refresh keeps the review in progress), cleared on a new import,
 * and exported in the 评审报告.
 */
export const createNotesSlice: StateCreator<AppState, [], [], NotesState> = (set) => ({
  fieldNotes: {},
  setFieldNote(table, column, text) {
    const key = fieldNoteKey(table, column);
    const trimmed = text.trim();
    set((s) => {
      const next = { ...s.fieldNotes };
      if (trimmed) next[key] = { text: trimmed, updatedAt: new Date().toISOString() };
      else delete next[key];
      return { fieldNotes: next };
    });
  },
});
