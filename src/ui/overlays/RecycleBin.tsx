import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import { nodeId } from '../../diagram/nodeId';
import { TrashIcon, RestoreIcon } from './icons';
import { PILL } from './pill';

/**
 * Recycle bin, bottom-left. Lists tables hidden from the diagram (via the
 * Delete key or the selection pill's trash) and restores them. The SQL is never
 * touched — this is a pure view filter (store.deletedTables); a restored table
 * returns to its saved position. Renders nothing while the bin is empty.
 */
export function RecycleBin() {
  const deletedTables = useApp((s) => s.deletedTables);
  const restoreTable = useApp((s) => s.restoreTable);
  const restoreAllTables = useApp((s) => s.restoreAllTables);
  const schema = useApp((s) => s.schema); // FULL schema → original-cased names
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const ids = Object.keys(deletedTables);
  const count = ids.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (count === 0) return null;

  const nameOf = (id: string) =>
    schema?.tables.find((t) => nodeId(t.name) === id)?.name ?? id.slice(2);

  return (
    <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2" ref={rootRef}>
      {open && (
        <div
          className={clsx(
            'w-60 rounded-lg p-1',
            'border border-ink-200 dark:border-inkd-300',
            'bg-white/95 dark:bg-inkd-100/95 backdrop-blur shadow-xl',
          )}
          role="menu"
          aria-label="回收站"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[12px] font-semibold text-ink-800 dark:text-inkd-800">
              回收站 · {count}
            </span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-ink-500 transition-colors hover:bg-ink-50 dark:text-inkd-600 dark:hover:bg-inkd-200"
              onClick={() => {
                restoreAllTables();
                setOpen(false);
              }}
            >
              全部恢复
            </button>
          </div>
          <ul className="max-h-64 overflow-auto">
            {ids.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-ink-700 transition-colors hover:bg-ink-50 dark:text-inkd-700 dark:hover:bg-inkd-200"
                  title={`恢复 ${nameOf(id)}`}
                  onClick={() => restoreTable(id)}
                >
                  <span className="truncate">{nameOf(id)}</span>
                  <span className="shrink-0 text-ink-400 dark:text-inkd-500">
                    <RestoreIcon />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={PILL}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-pressed={open}
          title="回收站"
          aria-label="回收站"
          className={clsx(
            'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors',
            open
              ? 'bg-ink-100 text-ink-800 dark:bg-inkd-300 dark:text-inkd-800'
              : 'text-ink-600 hover:bg-ink-50 hover:text-ink-800 dark:text-inkd-600 dark:hover:bg-inkd-200 dark:hover:text-inkd-800',
          )}
        >
          <TrashIcon />
          <span className="text-[12px] font-medium tabular-nums">{count}</span>
        </button>
      </div>
    </div>
  );
}
