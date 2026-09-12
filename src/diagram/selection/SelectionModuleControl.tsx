import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../store';
import type { ModulesResult } from '../../infer/inferModules';
import { MAX_MODULE_LABEL_LENGTH } from '../../infer/moduleCustomization';

export function SelectionModuleControl({
  selectedIds,
  current,
  modules,
  onNotice,
}: {
  selectedIds: ReadonlySet<string>;
  current: string;
  modules: ModulesResult;
  onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const notify = (key: string | null) =>
    onNotice(
      key === null
        ? `已恢复 ${selectedIds.size} 张表的自动分组`
        : `已将 ${selectedIds.size} 张表移到「${useApp.getState().modules.modules.get(key)?.label ?? key}」`,
    );
  return (
    <div
      ref={root}
      className="pointer-events-auto relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <select
        aria-label="批量修改所属模块"
        value={current}
        className="max-w-[190px] rounded-full border border-ink-200 bg-white px-2 py-0.5 text-[11px] text-ink-700 outline-none focus:border-blue-400 dark:border-inkd-300 dark:bg-inkd-100 dark:text-inkd-700"
        onChange={(event) => {
          const key = event.target.value;
          if (key === '__custom__') {
            setLabel('');
            setError('');
            setOpen(true);
            return;
          }
          setOpen(false);
          const target = key === '__auto__' ? null : key;
          useApp.getState().assignTablesToModule([...selectedIds], target);
          notify(target);
        }}
      >
        <option value="" disabled>
          多个模块 · 批量调整…
        </option>
        <option value="__custom__">＋ 新建自定义模块…</option>
        {modules.ordered.map((module) => (
          <option key={module.name} value={module.name}>
            移到 {module.label}
          </option>
        ))}
        <option value="__auto__">恢复自动分组</option>
      </select>
      {open && (
        <form
          role="dialog"
          aria-label="自定义模块"
          className="absolute bottom-full right-0 mb-3 w-72 rounded-lg border border-ink-200 bg-white p-3 shadow-xl dark:border-inkd-300 dark:bg-inkd-100"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const key = useApp.getState().createModuleForTables([...selectedIds], label);
              notify(key);
              setOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : '无法创建模块');
            }
          }}
        >
          <label className="block text-xs font-semibold">
            自定义模块名称
            <input
              autoFocus
              required
              maxLength={MAX_MODULE_LABEL_LENGTH}
              value={label}
              onKeyDown={(event) => {
                // Enter confirms an IME candidate before it submits the form.
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
              }}
              onChange={(e) => {
                setLabel(e.target.value);
                setError('');
              }}
              placeholder="例如：订单中心"
              className="mt-2 w-full rounded border border-ink-200 bg-transparent px-2 py-1.5 font-normal outline-none focus:border-blue-400 dark:border-inkd-300"
            />
          </label>
          <p className="mt-2 text-[11px] font-normal text-ink-500 dark:text-inkd-600">
            同名模块会直接复用；只调整分组，不修改 SQL。
          </p>
          {error && (
            <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 hover:bg-ink-50 dark:hover:bg-inkd-200"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!label.trim()}
              className="rounded bg-blue-600 px-2 py-1 text-white disabled:opacity-40"
            >
              创建并移入
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
