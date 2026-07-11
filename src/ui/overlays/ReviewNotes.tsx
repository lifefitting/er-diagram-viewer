import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import { formatNoteTime, parseFieldNoteKey } from '../../store/notesSlice';

/**
 * 评审建议浮层 — floating panel on the canvas's RIGHT edge listing the most
 * recent field review notes, newest first, so the review-in-progress is
 * visible at a glance. Collapsible to a small pill; clicking an item centers
 * and flashes the table on the canvas; the × clears the note. Hidden entirely
 * while there are no notes.
 */
export function ReviewNotesOverlay() {
  const fieldNotes = useApp((s) => s.fieldNotes);
  const setFieldNote = useApp((s) => s.setFieldNote);
  const flashTable = useApp((s) => s.flashTable);
  const [collapsed, setCollapsed] = useState(false);

  const notes = useMemo(
    () =>
      Object.entries(fieldNotes)
        .map(([key, note]) => {
          const parsed = parseFieldNoteKey(key);
          return parsed ? { ...parsed, ...note } : null;
        })
        .filter((n): n is NonNullable<typeof n> => !!n)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [fieldNotes],
  );

  if (notes.length === 0) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        className={clsx(
          'absolute right-3 top-16 z-20 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium shadow-lg backdrop-blur',
          'border-amber-200 bg-amber-50/95 text-amber-800 hover:bg-amber-100',
          'dark:border-amber-700/50 dark:bg-amber-900/80 dark:text-amber-300 dark:hover:bg-amber-900',
        )}
        title="展开评审建议列表"
        onClick={() => setCollapsed(false)}
      >
        <NoteGlyph />
        评审 {notes.length}
      </button>
    );
  }

  return (
    <aside
      className={clsx(
        'absolute right-3 top-16 z-20 w-[264px] max-h-[55%] flex flex-col overflow-hidden rounded-lg border shadow-xl backdrop-blur',
        'border-ink-100 bg-white/95 dark:border-inkd-300 dark:bg-inkd-100/95',
      )}
      aria-label="评审建议列表"
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-ink-100 bg-amber-50/60 px-2.5 dark:border-inkd-300 dark:bg-amber-900/20">
        <NoteGlyph />
        <span className="text-[12px] font-semibold text-ink-800 dark:text-inkd-800">评审建议</span>
        <span className="text-[10.5px] tabular-nums text-ink-400 dark:text-inkd-500">
          {notes.length}
        </span>
        <button
          type="button"
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-ink-400 transition-colors hover:bg-white hover:text-ink-700 dark:text-inkd-500 dark:hover:bg-inkd-200 dark:hover:text-inkd-800"
          title="折叠"
          onClick={() => setCollapsed(true)}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M4 6.5 8 10.5 12 6.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <ul className="min-h-0 overflow-y-auto">
        {notes.map((n) => (
          <li
            key={`${n.table}::${n.column}`}
            className="group border-b border-ink-100/70 last:border-b-0 dark:border-inkd-300/70"
          >
            <button
              type="button"
              className="w-full px-2.5 py-1.5 text-left transition-colors hover:bg-amber-50/60 dark:hover:bg-amber-900/15"
              title="点击定位到该表"
              onClick={() => flashTable(n.table)}
            >
              <span className="flex items-baseline gap-1.5">
                <code className="min-w-0 truncate font-mono text-[11px] text-ink-800 dark:text-inkd-800">
                  {n.table}
                  <span className="text-ink-400 dark:text-inkd-500">.{n.column}</span>
                </code>
                {n.updatedAt && (
                  <span className="ml-auto shrink-0 text-[9.5px] tabular-nums text-ink-300 dark:text-inkd-500">
                    {formatNoteTime(n.updatedAt)}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className="shrink-0 rounded p-0.5 text-ink-300 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100 dark:text-inkd-500 dark:hover:text-rose-400"
                  title="删除该批注"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFieldNote(n.table, n.column, '');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      setFieldNote(n.table, n.column, '');
                    }
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-600 line-clamp-2 dark:text-inkd-700">
                {n.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function NoteGlyph() {
  return (
    <span
      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-amber-500"
      aria-hidden
    />
  );
}
