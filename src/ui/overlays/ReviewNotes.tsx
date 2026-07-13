import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import {
  formatNoteTime,
  parseFieldNoteKey,
  severityLabel,
  severityRank,
  statusLabel,
} from '../../store/notesSlice';
import type { NoteSeverity, NoteStatus } from '../../store/types';

/** Marker-dot color per 级别 — same scale as the canvas row markers. */
const SEVERITY_DOT: Record<NoteSeverity, string> = {
  suggest: 'bg-amber-500',
  warn: 'bg-orange-500',
  block: 'bg-rose-500',
};

/** Next status in the one-click triage cycle: 待处理 → 已采纳 → 不采纳 → 待处理. */
const NEXT_STATUS: Record<NoteStatus, NoteStatus> = {
  open: 'accepted',
  accepted: 'rejected',
  rejected: 'open',
};

const STATUS_CHIP: Record<NoteStatus, string> = {
  open: 'border-ink-200 text-ink-500 dark:border-inkd-400 dark:text-inkd-600',
  accepted:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:
    'border-ink-200 bg-ink-50 text-ink-400 line-through dark:border-inkd-400 dark:bg-inkd-200 dark:text-inkd-500',
};

/**
 * 评审建议浮层 — floating panel on the canvas's RIGHT edge listing the field
 * review notes: 待处理 first, then by 级别 (阻塞 → 警告 → 建议), newest first
 * within a group, so the open blockers are always on top. Collapsible to a
 * small pill; clicking an item centers and flashes the table on the canvas;
 * the status chip cycles 待处理 → 已采纳 → 不采纳; the × clears the note.
 * Hidden entirely while there are no notes.
 */
export function ReviewNotesOverlay() {
  const fieldNotes = useApp((s) => s.fieldNotes);
  const setFieldNote = useApp((s) => s.setFieldNote);
  const setFieldNoteStatus = useApp((s) => s.setFieldNoteStatus);
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
        .sort((a, b) => {
          const openA = a.status === 'open' ? 0 : 1;
          const openB = b.status === 'open' ? 0 : 1;
          if (openA !== openB) return openA - openB;
          const rankDiff = severityRank(a.severity) - severityRank(b.severity);
          if (rankDiff !== 0) return rankDiff;
          return (b.updatedAt || '').localeCompare(a.updatedAt || '');
        }),
    [fieldNotes],
  );

  const counts = useMemo(() => {
    const bySeverity: Record<NoteSeverity, number> = { block: 0, warn: 0, suggest: 0 };
    let open = 0;
    for (const n of notes) {
      bySeverity[n.severity] += 1;
      if (n.status === 'open') open += 1;
    }
    return { bySeverity, open };
  }, [notes]);

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
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-amber-500"
          aria-hidden
        />
        评审 {notes.length}
        {counts.open > 0 && <span className="opacity-70">· 待处理 {counts.open}</span>}
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
        <span className="text-[12px] font-semibold text-ink-800 dark:text-inkd-800">评审建议</span>
        {/* 分级汇总: only non-zero severities get a chip, escalation first. */}
        <span className="flex items-center gap-1 text-[10px] tabular-nums text-ink-500 dark:text-inkd-600">
          {(['block', 'warn', 'suggest'] as const).map((sev) =>
            counts.bySeverity[sev] > 0 ? (
              <span key={sev} className="inline-flex items-center gap-0.5">
                <span
                  className={clsx('inline-block h-[6px] w-[6px] rounded-full', SEVERITY_DOT[sev])}
                  aria-hidden
                />
                {counts.bySeverity[sev]}
              </span>
            ) : null,
          )}
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
              className={clsx(
                'w-full px-2.5 py-1.5 text-left transition-colors hover:bg-amber-50/60 dark:hover:bg-amber-900/15',
                n.status !== 'open' && 'opacity-60',
              )}
              title="点击定位到该表"
              onClick={() => flashTable(n.table)}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={clsx(
                    'h-[7px] w-[7px] shrink-0 rounded-full',
                    SEVERITY_DOT[n.severity],
                  )}
                  title={severityLabel(n.severity)}
                  aria-label={`级别：${severityLabel(n.severity)}`}
                />
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
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </span>
              <span className="mt-0.5 flex items-start gap-1.5">
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink-600 line-clamp-2 dark:text-inkd-700">
                  {n.text}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className={clsx(
                    'shrink-0 rounded-full border px-1.5 py-px text-[9.5px] leading-[14px] transition-colors',
                    STATUS_CHIP[n.status],
                  )}
                  title={`状态：${statusLabel(n.status)}，点击改为「${statusLabel(NEXT_STATUS[n.status])}」`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFieldNoteStatus(n.table, n.column, NEXT_STATUS[n.status]);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      setFieldNoteStatus(n.table, n.column, NEXT_STATUS[n.status]);
                    }
                  }}
                >
                  {statusLabel(n.status)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
