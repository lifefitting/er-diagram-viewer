import { useMemo, useState } from 'react';
import { useApp } from '../../store';
import { fkKey } from '../../infer/inferForeignKeys';
import { discoverBusinessKeys } from '../../infer/inferLogicalLinks';
import { collectFkExclusions } from '../../store/pipeline';
import { FkRow } from './InferencePanel';

/**
 * 逻辑关联（业务键）— its own sidebar section, deliberately独立 from the FK
 * candidates: a logical link is a business-key association, not a foreign
 * key, and its inference is USER-TRIGGERED (scan → pick column names), not
 * confidence-tiered. Candidates the user doesn't believe are simply not
 * picked / rejected — there is no accept-all/progress flow here.
 */
export function LogicalPanel() {
  const schema = useApp((s) => s.schema);
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const acceptFk = useApp((s) => s.acceptFk);
  const rejectFk = useApp((s) => s.rejectFk);
  const batchClear = useApp((s) => s.batchClear);
  const logicalKeys = useApp((s) => s.logicalKeys);
  const setLogicalKeys = useApp((s) => s.setLogicalKeys);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const items = useMemo(() => inferred.filter((f) => f.kind === 'logical'), [inferred]);

  // Clusters for the picker — computed lazily (only while it's open).
  const clusters = useMemo(() => {
    if (!pickerOpen || !schema) return [];
    const fkOnly = inferred.filter((f) => f.kind !== 'logical');
    const { consumedColumns } = collectFkExclusions(schema, fkOnly);
    return discoverBusinessKeys(schema, consumedColumns);
  }, [pickerOpen, schema, inferred]);

  const openPicker = () => {
    setPicked(new Set(logicalKeys));
    setPickerOpen(true);
  };
  const confirmPicker = () => {
    setLogicalKeys([...picked].sort());
    setPickerOpen(false);
  };
  const removeKey = (name: string) => {
    setLogicalKeys(logicalKeys.filter((k) => k !== name));
  };

  if (!schema || schema.tables.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-ink-400 dark:text-inkd-500">
        导入 SQL 后可扫描业务键。
      </div>
    );
  }

  return (
    <div className="text-sm">
      {/* Picked business keys as removable chips + the scan trigger. */}
      <div className="px-3 py-1.5 flex flex-wrap items-center gap-1.5 border-b border-ink-100/70 dark:border-inkd-300/70">
        {logicalKeys.map((name) => (
          <span
            key={name}
            className={
              'inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10.5px] ' +
              'border-violet-200 bg-violet-50 text-violet-700 ' +
              'dark:border-violet-700/40 dark:bg-violet-900/30 dark:text-violet-300'
            }
          >
            {name}
            <button
              type="button"
              className="hover:text-rose-600 dark:hover:text-rose-400"
              title={`移除业务键 ${name}（其候选与决策随之消失）`}
              onClick={() => removeKey(name)}
            >
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <button
          type="button"
          className={
            'h-5 rounded border px-1.5 text-[10.5px] font-medium transition-colors ' +
            'border-violet-300 text-violet-700 hover:bg-violet-50 ' +
            'dark:border-violet-700/50 dark:text-violet-300 dark:hover:bg-violet-900/30'
          }
          onClick={pickerOpen ? () => setPickerOpen(false) : openPicker}
        >
          {pickerOpen ? '收起扫描' : logicalKeys.length > 0 ? '重新扫描…' : '扫描业务键…'}
        </button>
      </div>

      {pickerOpen && (
        <div className="border-b border-ink-100/70 dark:border-inkd-300/70">
          {clusters.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-ink-400 dark:text-inkd-500">
              未发现跨表共享的候选业务键列。
            </div>
          ) : (
            <>
              <div className="px-3 pt-1.5 text-[10.5px] text-ink-400 dark:text-inkd-500">
                勾选用哪些字段推断（同名字段很多时全推会很乱）：
              </div>
              <ul className="max-h-48 overflow-y-auto py-1">
                {clusters.map((c) => {
                  const checked = picked.has(c.name);
                  return (
                    <li key={c.name}>
                      <label
                        className={
                          'flex items-center gap-2 px-3 py-1 text-[11.5px] ' +
                          (c.selectable
                            ? 'cursor-pointer hover:bg-ink-50 dark:hover:bg-inkd-200'
                            : 'opacity-45 cursor-not-allowed')
                        }
                        title={
                          c.selectable
                            ? `出现在：${c.tables.join('、')}`
                            : `出现在 ${c.tables.length} 张表且无唯一索引侧——全配对会产生大量连线，请用拖线手动补关键的几条`
                        }
                      >
                        <input
                          type="checkbox"
                          className="accent-violet-600"
                          disabled={!c.selectable}
                          checked={checked}
                          onChange={() =>
                            setPicked((s) => {
                              const next = new Set(s);
                              if (next.has(c.name)) next.delete(c.name);
                              else next.add(c.name);
                              return next;
                            })
                          }
                        />
                        <code className="font-mono text-ink-800 dark:text-inkd-800 truncate">
                          {c.name}
                        </code>
                        <span className="text-[10px] text-ink-400 dark:text-inkd-500 tabular-nums shrink-0">
                          {c.tables.length} 表
                        </span>
                        {c.hubTable ? (
                          <span className="ml-auto shrink-0 rounded border border-emerald-200/70 bg-emerald-50 px-1 text-[9.5px] text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/30 dark:text-emerald-300">
                            唯一侧 {c.hubTable}
                          </span>
                        ) : (
                          <span className="ml-auto shrink-0 rounded border border-amber-200/70 bg-amber-50 px-1 text-[9.5px] text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-300">
                            无唯一侧
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end gap-1.5 px-3 pb-2">
                <button
                  type="button"
                  className="h-6 rounded border border-ink-200 px-2 text-[11px] text-ink-500 hover:bg-ink-50 dark:border-inkd-300 dark:text-inkd-600 dark:hover:bg-inkd-200"
                  onClick={() => setPickerOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={
                    'h-6 rounded px-2 text-[11px] font-medium text-white transition-colors ' +
                    'bg-violet-600 hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600'
                  }
                  onClick={confirmPicker}
                >
                  按 {picked.size} 个字段生成候选
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {items.length === 0 && !pickerOpen && (
        <div className="px-3 py-1.5 text-[10.5px] text-ink-400 dark:text-inkd-500">
          分库分表下通过业务键（如 out_trade_no）关联、没有物理外键的表，
          扫描后选择字段即可生成候选。看不上的候选拒绝或不勾选即可。
        </div>
      )}

      {items.length > 0 && (
        <ul>
          {items.map((fk) => (
            <FkRow
              key={fkKey(fk)}
              fk={fk}
              decision={decisions[fkKey(fk)]}
              bar="bg-violet-400"
              undirected
              onAccept={() => acceptFk(fkKey(fk))}
              onReject={() => rejectFk(fkKey(fk))}
              onClear={() => batchClear([fkKey(fk)])}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
