import { useMemo, useState } from 'react';
import { useApp } from '../../store';
import { fkKey } from '../../infer/inferForeignKeys';
import type { Table } from '../../parser/types';
import { manualFkFromDraft, validateManualFk } from '../../store/manualFkValidate';

const SELECT_CLS =
  'w-full h-6 px-1 text-[11px] rounded border border-ink-200 dark:border-inkd-300 ' +
  'bg-white dark:bg-inkd-200 text-ink-800 dark:text-inkd-800 ' +
  'focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:opacity-50';

/**
 * 手动连线 — its own sidebar section: the record of every hand-drawn relation
 * (canvas drag-connect or the form below). Drag-connect is "连完即所得": the
 * drop creates the relation immediately with a sensible default type (target
 * is PK/unique → 物理外键, else 逻辑关联) and NO per-drop confirmation; THIS
 * panel is where types are reviewed and batch-edited afterwards — each row has
 * a 物理/逻辑 toggle.
 */
export function ManualFkPanel() {
  const schema = useApp((s) => s.schema);
  const inferred = useApp((s) => s.inferred);
  const manualFks = useApp((s) => s.manualFks);
  const addManualFk = useApp((s) => s.addManualFk);
  const removeManualFk = useApp((s) => s.removeManualFk);
  const setManualFkKind = useApp((s) => s.setManualFkKind);

  // The select-based form is a rarely-used fallback (the canvas drag gesture
  // is the primary path) — hidden behind a disclosure so it doesn't take
  // permanent space in the panel.
  const [formOpen, setFormOpen] = useState(false);
  // 'fk' = physical foreign key; 'logical' = business-key association.
  const [kind, setKind] = useState<'fk' | 'logical'>('fk');
  const [fromTable, setFromTable] = useState('');
  const [fromCol, setFromCol] = useState('');
  const [toTable, setToTable] = useState('');
  const [toCol, setToCol] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Row-level error from a failed kind toggle (key collision), keyed by fkKey.
  const [rowError, setRowError] = useState<{ key: string; text: string } | null>(null);

  const tables = useMemo(
    () => (schema ? [...schema.tables].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [schema],
  );
  const tableByName = useMemo(
    () => new Map<string, Table>(tables.map((t) => [t.name, t])),
    [tables],
  );

  if (!schema || tables.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-ink-400 dark:text-inkd-500">
        导入 SQL 后可手动连线。
      </div>
    );
  }

  const fromCols = tableByName.get(fromTable)?.columns ?? [];
  const toCols = tableByName.get(toTable)?.columns ?? [];
  const complete = !!(fromTable && fromCol && toTable && toCol);

  const pickToTable = (name: string) => {
    setToTable(name);
    const t = tableByName.get(name);
    // Default target column: business keys join on the SAME column name, so a
    // logical draft prefers the source column's namesake; physical FKs (and
    // the fallback) default to the PK — the overwhelmingly common case.
    const namesake =
      kind === 'logical' && fromCol
        ? t?.columns.find((c) => c.name.toLowerCase() === fromCol.toLowerCase())?.name
        : undefined;
    setToCol(namesake ?? t?.primaryKey[0] ?? t?.columns[0]?.name ?? '');
  };

  const submit = () => {
    if (!complete) return;
    const draft = { fromTable, fromColumn: fromCol, toTable, toColumn: toCol, kind };
    const err = validateManualFk(draft, schema, inferred, manualFks);
    if (err) {
      setError(err);
      return;
    }
    addManualFk(manualFkFromDraft(draft));
    setError(null);
    setFromCol('');
  };

  const toggleKind = (key: string, next: 'fk' | 'logical') => {
    const err = setManualFkKind(key, next);
    setRowError(err ? { key, text: err } : null);
  };

  return (
    <div className="text-sm">
      {manualFks.length === 0 && (
        <div className="px-3 py-1.5 text-[10.5px] text-ink-400 dark:text-inkd-500 border-b border-ink-100/70 dark:border-inkd-300/70">
          在画布上悬停字段、从两侧圆点拖线到目标字段即可连线（目标是主键/唯一列
          时记为物理外键，否则记为逻辑关联）；每条连线都会记录在这里，类型可随时切换。
        </div>
      )}
      {manualFks.length > 0 && (
        <ul className="border-b border-ink-100/70 dark:border-inkd-300/70">
          {manualFks.map((fk) => {
            const k = fkKey(fk);
            const isLogical = fk.kind === 'logical';
            const sep = isLogical ? '~' : '→';
            const pathStr = `${fk.fromTable}.${fk.fromColumns.join(',')} ${sep} ${fk.toTable}.${fk.toColumns.join(',')}`;
            return (
              <li
                key={k}
                className="relative pl-3 pr-2 py-1.5 border-b border-ink-100/70 dark:border-inkd-300/70 last:border-b-0"
                title={isLogical ? `${pathStr}\n业务键逻辑关联（无物理约束）` : pathStr}
              >
                <span
                  className={
                    'absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ' +
                    (isLogical ? 'bg-violet-500' : 'bg-sky-500')
                  }
                  aria-hidden
                />
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-[11.5px] truncate flex-1 text-ink-800 dark:text-inkd-800">
                    <span>{fk.fromTable}</span>
                    <span className="text-ink-500 dark:text-inkd-600">
                      .{fk.fromColumns.join(',')}
                    </span>
                    <span className="text-ink-300 dark:text-inkd-500 mx-0.5">{sep}</span>
                    <span>{fk.toTable}</span>
                    <span className="text-ink-500 dark:text-inkd-600">
                      .{fk.toColumns.join(',')}
                    </span>
                  </code>
                  <span className="flex items-center gap-0.5 shrink-0">
                    <KindToggle
                      kind={fk.kind === 'logical' ? 'logical' : 'fk'}
                      onChange={(next) => toggleKind(k, next)}
                    />
                    <button
                      type="button"
                      className={
                        'inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-colors ' +
                        'text-ink-400 dark:text-inkd-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 ' +
                        'hover:text-rose-600 dark:hover:text-rose-300'
                      }
                      title="移除该连线"
                      onClick={() => removeManualFk(k)}
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path
                          d="M4 4l8 8M12 4l-8 8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </span>
                </div>
                {rowError?.key === k && (
                  <div className="mt-0.5 text-[10px] text-rose-600 dark:text-rose-400">
                    {rowError.text}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Form fallback for adding without the canvas gesture — collapsed by
          default; the drag gesture is the primary path. */}
      <div className="px-3 py-1.5">
        <button
          type="button"
          className="text-[10.5px] text-ink-400 hover:text-ink-600 dark:text-inkd-500 dark:hover:text-inkd-700 transition-colors"
          aria-expanded={formOpen}
          onClick={() => setFormOpen((v) => !v)}
        >
          {formOpen ? '收起表单' : '不方便拖线？用表单添加…'}
        </button>
      </div>
      {formOpen && (
      <div className="px-3 pb-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-7 shrink-0 text-[10px] text-ink-400 dark:text-inkd-500">类型</span>
          <div
            className="flex rounded border border-ink-200 dark:border-inkd-300 overflow-hidden"
            role="radiogroup"
            aria-label="关系类型"
          >
            {(
              [
                ['fk', '物理外键'],
                ['logical', '逻辑关联'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={
                  'px-2 h-5 text-[10.5px] transition-colors ' +
                  (kind === value
                    ? value === 'logical'
                      ? 'bg-violet-600 text-white'
                      : 'bg-sky-600 text-white'
                    : 'bg-white dark:bg-inkd-200 text-ink-500 dark:text-inkd-600 hover:bg-ink-50 dark:hover:bg-inkd-300')
                }
                title={
                  value === 'logical'
                    ? '业务键关联（如 out_trade_no）：无物理约束，点状无向线，DDL 导出为注释'
                    : '物理外键：实线箭头，DDL 导出为 ALTER TABLE ADD CONSTRAINT'
                }
                onClick={() => {
                  setKind(value);
                  setError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-7 shrink-0 text-[10px] text-ink-400 dark:text-inkd-500">源</span>
          <select
            value={fromTable}
            onChange={(e) => {
              setFromTable(e.target.value);
              setFromCol('');
              setError(null);
            }}
            className={SELECT_CLS}
            aria-label="源表"
          >
            <option value="">选择表…</option>
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={fromCol}
            onChange={(e) => {
              setFromCol(e.target.value);
              setError(null);
            }}
            className={SELECT_CLS}
            disabled={!fromTable}
            aria-label="源列"
          >
            <option value="">列…</option>
            {fromCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-7 shrink-0 text-[10px] text-ink-400 dark:text-inkd-500">目标</span>
          <select
            value={toTable}
            onChange={(e) => {
              pickToTable(e.target.value);
              setError(null);
            }}
            className={SELECT_CLS}
            aria-label="目标表"
          >
            <option value="">选择表…</option>
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={toCol}
            onChange={(e) => {
              setToCol(e.target.value);
              setError(null);
            }}
            className={SELECT_CLS}
            disabled={!toTable}
            aria-label="目标列"
          >
            <option value="">列…</option>
            {toCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div className="pl-[34px] text-[10.5px] text-rose-600 dark:text-rose-400">{error}</div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!complete}
            onClick={submit}
            className={
              'h-6 px-2.5 rounded text-[11px] font-medium transition-colors ' +
              'bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-600 ' +
              'disabled:bg-ink-100 disabled:text-ink-400 dark:disabled:bg-inkd-200 dark:disabled:text-inkd-500 ' +
              'disabled:cursor-not-allowed'
            }
          >
            添加连线
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

/** Tiny per-row 物理/逻辑 segmented toggle. */
function KindToggle({
  kind,
  onChange,
}: {
  kind: 'fk' | 'logical';
  onChange: (next: 'fk' | 'logical') => void;
}) {
  return (
    <span
      className="inline-flex overflow-hidden rounded border border-ink-200 dark:border-inkd-300"
      role="radiogroup"
      aria-label="连线类型"
    >
      {(
        [
          ['fk', '物理'],
          ['logical', '逻辑'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={kind === value}
          className={
            'px-1 h-[18px] text-[9.5px] leading-none transition-colors ' +
            (kind === value
              ? value === 'logical'
                ? 'bg-violet-600 text-white'
                : 'bg-sky-600 text-white'
              : 'bg-white dark:bg-inkd-200 text-ink-400 dark:text-inkd-500 hover:bg-ink-50 dark:hover:bg-inkd-300')
          }
          title={value === 'logical' ? '切换为逻辑关联（业务键，无向点线）' : '切换为物理外键（实线箭头）'}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
