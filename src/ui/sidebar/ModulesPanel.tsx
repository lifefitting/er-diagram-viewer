import { useApp } from '../../store';
import { useState } from 'react';
import { ModuleColorEditor } from './ModuleColorEditor';

/** Module legend list. Section header lives in the parent AccordionSection. */
export function ModulesPanel() {
  const modules = useApp((s) => s.modules);
  const overrideCount = useApp((s) => Object.keys(s.moduleOverrides).length);
  const flashModule = useApp((s) => s.flashModule);
  const [editingColor, setEditingColor] = useState<string | null>(null);

  if (modules.ordered.length === 0) {
    return null;
  }

  return (
    <div className="px-2 py-1.5">
      <div className="space-y-0.5">
        {modules.ordered.map((m) => (
          <div key={m.name} data-module-row={m.name}>
            <div
              className={
                'group/row w-full flex items-center gap-2 px-1.5 py-1 rounded ' +
                'text-left hover:bg-ink-50 dark:hover:bg-inkd-200 transition-colors'
              }
            >
              <button
                type="button"
                aria-label={`修改「${m.label}」的颜色`}
                title="点击修改模块颜色"
                aria-expanded={editingColor === m.name}
                className="h-5 w-5 shrink-0 rounded p-1 hover:ring-1 hover:ring-blue-400"
                onClick={() => setEditingColor((key) => (key === m.name ? null : m.name))}
              >
                <span
                  className="block h-3 w-3 rounded-sm"
                  style={{ background: m.color.header, border: `1px solid ${m.color.border}` }}
                />
              </button>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-label={`定位模块 ${m.label}`}
                title="点击在画布上定位到该模块的所有表"
                onClick={() => flashModule(m.name)}
              >
                <span className="text-[12px] font-medium text-ink-800 dark:text-inkd-800 truncate flex-1">
                  {m.label}
                </span>
                {/* Hover affordance: a tiny "→ 定位" hint that fades in only
                when the row is hovered. Replaces the static bottom-of-panel
                instructions, putting the affordance right where the user
                aims their cursor. */}
                <span
                  className={
                    'flex items-center gap-0.5 text-[9.5px] text-ink-400 dark:text-inkd-500 ' +
                    'opacity-0 group-hover/row:opacity-100 transition-opacity'
                  }
                  aria-hidden
                >
                  <LocateIcon />
                  <span>定位</span>
                </span>
                <span className="text-[10px] text-ink-400 dark:text-inkd-500 tabular-nums shrink-0 w-4 text-right">
                  {m.tables.length}
                </span>
              </button>
            </div>
            {editingColor === m.name && (
              <ModuleColorEditor module={m} onClose={() => setEditingColor(null)} />
            )}
          </div>
        ))}
      </div>
      {/* Replaced the always-visible 3-line bottom hint with a single info
          chip that exposes the "how it works" text on hover. Keeps the
          module legend dense while still surfacing the explanation when a
          new user needs it. */}
      <div className="mt-1.5 px-1.5 flex items-center gap-1">
        <span
          className={
            'inline-flex items-center gap-1 text-[10px] text-ink-400 dark:text-inkd-500 ' +
            'cursor-help select-none'
          }
          title={
            '· 模块按表名前缀 + FK 邻接关系自动归类\n' +
            '· Shift/⌘ 多选表后，可在画布底部新建自定义模块、批量移动或恢复自动分组\n' +
            '· 点击色块修改颜色；点击模块名称定位到该模块的所有表\n' +
            '· 顶部色板按钮切换整套配色；自选颜色保留，需单独恢复默认'
          }
        >
          <InfoIcon />
          <span>关于模块分组</span>
          {overrideCount > 0 && <span>· 已人工调整 {overrideCount} 张</span>}
        </span>
      </div>
    </div>
  );
}

/**
 * Small action buttons that the parent AccordionSection puts in the header.
 * Extracted here so the wiring (collapseAll / expandAll from the store) stays
 * close to the module-panel concerns.
 */
export function ModulesPanelHeaderActions() {
  const collapseAll = useApp((s) => s.collapseAll);
  const expandAll = useApp((s) => s.expandAll);
  return (
    <>
      <button
        className="text-[10.5px] text-ink-500 dark:text-inkd-600 hover:text-ink-800 dark:hover:text-inkd-800 px-1.5 py-0.5 rounded hover:bg-ink-50 dark:hover:bg-inkd-200"
        onClick={collapseAll}
        title="折叠所有表（仅显示表头）"
      >
        全部折叠
      </button>
      <button
        className="text-[10.5px] text-ink-500 dark:text-inkd-600 hover:text-ink-800 dark:hover:text-inkd-800 px-1.5 py-0.5 rounded hover:bg-ink-50 dark:hover:bg-inkd-200"
        onClick={expandAll}
        title="展开所有表"
      >
        全部展开
      </button>
    </>
  );
}

function LocateIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.7" fill="currentColor" />
    </svg>
  );
}
