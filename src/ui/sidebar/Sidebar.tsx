import { useMemo } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import { fkKey } from '../../infer/inferForeignKeys';
import { AccordionSection } from './AccordionSection';
import { DisplayControls } from './DisplayControls';
import { InferencePanel } from './InferencePanel';
import { LogicalPanel } from './LogicalPanel';
import { ManualFkPanel } from './ManualFkPanel';
import { ModulesPanel, ModulesPanelHeaderActions } from './ModulesPanel';
import {
  CollapseLeftIcon,
  SectionIconBlocks,
  SectionIconEye,
  SectionIconLightbulb,
  SectionIconLink,
  SectionIconPen,
  SectionIconSparklesWand,
  SectionIconWarning,
  SparklesIcon,
} from './icons';
import { CollapsedSidebarRail } from './CollapsedSidebarRail';
import { GroupHeading } from './GroupHeading';

/**
 * Floating, top-left "智能面板". Two visible states:
 *   - Expanded: a panel with all sections (display controls, modules,
 *               inferred FKs, notices, warnings).
 *   - Collapsed: just a rail (handled by `CollapsedSidebarRail`).
 *
 * Sizing math: the panel sizes to its content and only caps at
 * `max-h-[calc(100%-24px)]` (viewport minus 12px top + 12px bottom gap) when
 * sections are fully expanded. Collapsing the last section therefore "lifts"
 * the bottom edge instead of leaving an empty white block hanging down.
 *
 * The chrome header has `shrink-0` so it always shows; the section list uses
 * the default `flex: 0 1 auto` (no `flex-1` here on purpose) so it grows only
 * to its natural content height and only shrinks when the panel hits its
 * max-height cap.
 */
/** 隐藏连线/显示连线 toggle in the 逻辑关联 / 手动连线 section headers —
 *  flips the whole category on the canvas at once (compare the physical-only
 *  picture vs the full one) without touching any decision. */
function EdgeVisibilityToggle({ field }: { field: 'showLogicalLinks' | 'showManualLinks' }) {
  const on = useApp((s) => s.display[field]);
  const toggleDisplay = useApp((s) => s.toggleDisplay);
  return (
    <button
      className={clsx(
        'text-[10.5px] px-1.5 py-0.5 rounded transition-colors',
        on
          ? 'text-ink-500 dark:text-inkd-600 hover:text-ink-800 dark:hover:text-inkd-800 hover:bg-ink-50 dark:hover:bg-inkd-200'
          : 'text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30 dark:hover:bg-amber-900/50',
      )}
      onClick={() => toggleDisplay(field)}
      title={on ? '在画布上隐藏这一类连线（决策不受影响）' : '重新显示这一类连线'}
    >
      {on ? '隐藏连线' : '显示连线'}
    </button>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const moduleCount = useApp((s) => s.modules.ordered.length);
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const showLow = useApp((s) => s.display.showLowConfidence);
  const warnings = useApp((s) => s.schema?.warnings ?? []);
  const notices = useApp((s) => s.schema?.notices ?? []);
  const display = useApp((s) => s.display);
  const manualCount = useApp((s) => s.manualFks.length);
  const logicalKeyCount = useApp((s) => s.logicalKeys.length);

  // FK candidates vs logical (business-key) candidates are SEPARATE sections:
  // an FK candidate carries a confidence tier and a decision workflow; a
  // logical link is user-triggered (scan → pick keys) with no tiers.
  const { fkInferred, logicalCount } = useMemo(() => {
    let logical = 0;
    const fk = inferred.filter((f) => {
      if (f.kind === 'logical') {
        logical++;
        return false;
      }
      return true;
    });
    return { fkInferred: fk, logicalCount: logical };
  }, [inferred]);

  // Subtitle for "推断的外键": mirror what the visible FK candidates show
  // (low-confidence ones are hidden unless the user toggles them on). The
  // collapsed-state line then matches what the user actually sees once they
  // expand the section.
  const inferenceSubtitle = useMemo(() => {
    if (fkInferred.length === 0) return '尚无推断结果';
    const visible = fkInferred.filter((fk) => fk.confidence !== 'low' || showLow);
    const decided = visible.reduce((n, fk) => (decisions[fkKey(fk)] ? n + 1 : n), 0);
    const pending = visible.length - decided;
    if (pending === 0) return `${decided} 条候选已全部决策`;
    return `${pending} 待定 · ${decided} 已决策`;
  }, [fkInferred, decisions, showLow]);

  const displaySubtitle = useMemo(() => {
    if (display.onlyPk) return '仅主键模式';
    const on: string[] = [];
    if (display.showType) on.push('类型');
    if (display.showComment) on.push('注释');
    if (display.showIndex) on.push('索引徽标');
    if (on.length === 0) return '仅列名';
    return on.join(' · ');
  }, [display]);

  const inferredCount = fkInferred.length;

  if (collapsed) {
    return <CollapsedSidebarRail onExpand={toggleSidebar} />;
  }

  return (
    <aside
      className={clsx(
        'absolute left-3 top-3 max-h-[calc(100%-24px)] w-[320px] z-30',
        'bg-white/95 dark:bg-inkd-100/95 backdrop-blur',
        'supports-[backdrop-filter]:bg-white/90 supports-[backdrop-filter]:dark:bg-inkd-100/85',
        'border border-ink-100 dark:border-inkd-300 rounded-lg',
        // Drop-shadow is heavier in light mode for the card-floating look;
        // in dark mode we lean on the border + a subtle outer glow because
        // dark-on-dark shadows look smudgy.
        'shadow-[0_8px_28px_-4px_rgba(15,23,42,0.18)] dark:shadow-[0_8px_28px_-4px_rgba(0,0,0,0.6)]',
        'flex flex-col min-h-0 overflow-hidden',
      )}
    >
      <div
        className={clsx(
          'flex items-center gap-2 pl-3 pr-1.5 h-11 shrink-0',
          'border-b border-ink-100 dark:border-inkd-300',
          'bg-gradient-to-r from-indigo-50/70 via-white to-white',
          'dark:from-indigo-950/40 dark:via-inkd-100 dark:to-inkd-100',
        )}
      >
        <span
          className={clsx(
            'inline-flex items-center justify-center h-6 w-6 rounded-md',
            'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-sm',
          )}
          aria-hidden
        >
          <SparklesIcon size={13} />
        </span>
        <div className="flex flex-col leading-tight min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold text-ink-800 dark:text-inkd-800 tracking-tight">
            智能面板
          </span>
          <span className="text-[10px] text-ink-400 dark:text-inkd-500">
            Schema Insights · ER Assistant
          </span>
        </div>
        <button
          className={clsx(
            'inline-flex items-center justify-center h-7 w-7 rounded-md',
            'text-ink-400 dark:text-inkd-500',
            'hover:text-ink-800 dark:hover:text-inkd-800',
            'hover:bg-white dark:hover:bg-inkd-200 transition-colors',
          )}
          onClick={toggleSidebar}
          title="收起到左侧"
          aria-label="收起侧边栏"
        >
          <CollapseLeftIcon />
        </button>
      </div>
      {/* Single scroll container for ALL accordion sections so the user
          gets one continuous list rather than several mini-scrollboxes.
          Intentionally not `flex-1`: we want this div to be content-height
          when everything fits, and only scroll once the aside's max-height
          forces it to shrink (flex-shrink default = 1 lets that happen). */}
      <div className="overflow-y-auto min-h-0">
        <GroupHeading label="显示设置" hint="Display" />

        <AccordionSection
          title="字段显示"
          subtitle={displaySubtitle}
          icon={<SectionIconEye />}
          defaultOpen={false}
        >
          <DisplayControls />
        </AccordionSection>

        {moduleCount > 0 && (
          <AccordionSection
            title="模块"
            subtitle="按表名前缀 + FK 邻接自动着色分组"
            icon={<SectionIconBlocks />}
            count={moduleCount}
            defaultOpen={true}
            actions={<ModulesPanelHeaderActions />}
          >
            <ModulesPanel />
          </AccordionSection>
        )}

        <GroupHeading label="智能分析" hint="Insights" />

        <AccordionSection
          title="推断的外键"
          subtitle={inferenceSubtitle}
          icon={<SectionIconSparklesWand />}
          count={inferredCount}
          defaultOpen={inferredCount > 0}
        >
          <InferencePanel />
        </AccordionSection>

        <AccordionSection
          title="逻辑关联"
          subtitle={
            logicalCount > 0
              ? `${logicalCount} 条业务键关联`
              : logicalKeyCount > 0
                ? `已选 ${logicalKeyCount} 个业务键`
                : '业务键关联 · 按需扫描'
          }
          icon={<SectionIconLink />}
          count={logicalCount || undefined}
          defaultOpen={logicalCount > 0}
          actions={logicalCount > 0 ? <EdgeVisibilityToggle field="showLogicalLinks" /> : undefined}
        >
          <LogicalPanel />
        </AccordionSection>

        <AccordionSection
          title="手动连线"
          subtitle={manualCount > 0 ? '类型可在此批量调整' : '画布拖线或表单添加'}
          icon={<SectionIconPen />}
          count={manualCount || undefined}
          defaultOpen={false}
          actions={manualCount > 0 ? <EdgeVisibilityToggle field="showManualLinks" /> : undefined}
        >
          <ManualFkPanel />
        </AccordionSection>

        {notices.length > 0 && (
          <AccordionSection
            title="智能提示"
            subtitle="基于命名与结构的发现"
            icon={<SectionIconLightbulb />}
            count={notices.length}
            defaultOpen={false}
            variant="info"
          >
            <div className="px-3 py-2 text-[11.5px] leading-relaxed text-sky-800 dark:text-sky-300 space-y-1.5">
              {notices.map((n, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="text-sky-400 dark:text-sky-500 select-none">•</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </AccordionSection>
        )}

        {warnings.length > 0 && (
          <AccordionSection
            title="解析告警"
            subtitle="无法识别的语句或结构问题"
            icon={<SectionIconWarning />}
            count={warnings.length}
            defaultOpen={true}
            variant="warning"
          >
            <div className="px-3 py-2 text-[11px] leading-snug text-rose-700 dark:text-rose-300 space-y-1 font-mono">
              {warnings.map((w, i) => (
                <div key={i}>
                  L{w.line}: {w.message}
                  {w.snippet ? ` — ${w.snippet}` : ''}
                </div>
              ))}
            </div>
          </AccordionSection>
        )}
      </div>
    </aside>
  );
}
