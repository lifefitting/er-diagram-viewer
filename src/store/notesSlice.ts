import type { StateCreator } from 'zustand';
import type { AppState, NotesState, NoteSeverity, NoteStatus } from './types';

/** Display metadata for the three severities（级别）, in escalation order.
 *  Pure data — shared by the note bubble, the review overlay and the report. */
export const NOTE_SEVERITIES: ReadonlyArray<{ id: NoteSeverity; label: string }> = [
  { id: 'suggest', label: '建议' },
  { id: 'warn', label: '警告' },
  { id: 'block', label: '阻塞' },
];

/** Display metadata for the three statuses（状态）, in flow order. */
export const NOTE_STATUSES: ReadonlyArray<{ id: NoteStatus; label: string }> = [
  { id: 'open', label: '待处理' },
  { id: 'accepted', label: '已采纳' },
  { id: 'rejected', label: '不采纳' },
];

export const severityLabel = (s: NoteSeverity): string =>
  NOTE_SEVERITIES.find((x) => x.id === s)?.label ?? s;
export const statusLabel = (s: NoteStatus): string =>
  NOTE_STATUSES.find((x) => x.id === s)?.label ?? s;

/** Sort weight: 阻塞 first, 建议 last. */
export const severityRank = (s: NoteSeverity): number => (s === 'block' ? 0 : s === 'warn' ? 1 : 2);

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
  setFieldNote(table, column, text, meta) {
    const key = fieldNoteKey(table, column);
    const trimmed = text.trim();
    set((s) => {
      const next = { ...s.fieldNotes };
      if (trimmed) {
        const prev = next[key];
        next[key] = {
          text: trimmed,
          updatedAt: new Date().toISOString(),
          // meta wins → existing value survives an edit → new notes default
          severity: meta?.severity ?? prev?.severity ?? 'suggest',
          status: meta?.status ?? prev?.status ?? 'open',
        };
      } else delete next[key];
      return { fieldNotes: next };
    });
  },
  setFieldNoteStatus(table, column, status) {
    const key = fieldNoteKey(table, column);
    set((s) => {
      const prev = s.fieldNotes[key];
      if (!prev || prev.status === status) return s;
      return { fieldNotes: { ...s.fieldNotes, [key]: { ...prev, status } } };
    });
  },
});
