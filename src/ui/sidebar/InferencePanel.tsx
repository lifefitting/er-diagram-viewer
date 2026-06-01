import { useMemo, useState } from 'react';
import { useApp } from '../../store';
import { fkKey, type InferredFK } from '../../infer/inferForeignKeys';

type Confidence = 'high' | 'medium' | 'low';

/**
 * Inference list, redesigned for density.
 *
 * Design notes (responding to "UI 展示得有些混乱"):
 *  - Removed the per-group batch buttons: the same 3 buttons (accept all /
 *    reject all / clear) now only live in the section's batch row at the top.
 *    Repeating them inside every confidence group was the biggest source of
 *    visual noise.
 *  - Each FK candidate is now a single-row entity (with one optional small
 *    reason line below). Accept/reject are tight icon toggles that double as
 *    state indicators when the decision is already made.
 *  - Group headers lost their saturated full-row tint (which read as
 *    "accepted" green). Confidence is now communicated by a thin colored
 *    left bar on FK items instead, plus a small dot in the group header.
 *  - Reason strings are tokenized into 2–3 letter chips that fit on one
 *    line; the original reason stays available via the row's `title` tooltip.
 */
export function InferencePanel() {
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const acceptFk = useApp((s) => s.acceptFk);
  const rejectFk = useApp((s) => s.rejectFk);
  const batchDecide = useApp((s) => s.batchDecide);
  const batchClear = useApp((s) => s.batchClear);
  const resetDecisions = useApp((s) => s.resetDecisions);
  const showLow = useApp((s) => s.display.showLowConfidence);
  const toggleDisplay = useApp((s) => s.toggleDisplay);

  // Default: high expanded (most users decide these first), medium/low folded.
  // The user can flip both via the group chevrons; we don't override them
  // again once the panel is shown.
  const [openGroups, setOpenGroups] = useState<Record<Confidence, boolean>>({
    high: true,
    medium: false,
    low: false,
  });

  const groups = useMemo(() => {
    const g: Record<Confidence, InferredFK[]> = { high: [], medium: [], low: [] };
    for (const fk of inferred) g[fk.confidence].push(fk);
    return g;
  }, [inferred]);

  if (inferred.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-ink-400 dark:text-inkd-500">
        尚未推断出隐式外键。
      </div>
    );
  }

  // Visible candidates depend on the showLow toggle in the footer.
  const visibleConfs: Confidence[] = (['high', 'medium', 'low'] as const).filter(
    (c) => c !== 'low' || showLow,
  );
  const allKeys = visibleConfs.flatMap((c) => groups[c].map(fkKey));
  const decidedCount = allKeys.reduce((n, k) => (decisions[k] ? n + 1 : n), 0);
  const pendingCount = allKeys.length - decidedCount;

  // Progress fraction across the visible candidates (0-1). Drives the thin
  // bar at the top of the inference toolbar — a faster scan than the
  // "X 待定 · Y 已决策" text alone.
  const progress = allKeys.length === 0 ? 0 : decidedCount / allKeys.length;

  return (
    <div className="text-sm">
      {/* Thin progress rail above the toolbar. Doesn't compete with the
          batch buttons for horizontal real estate, and reads as a "review
          progress" indicator at a glance. Color shifts to emerald once
          every candidate has been decided. */}
      <div
        className="h-[3px] bg-ink-100/80 dark:bg-inkd-300/80 relative overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={allKeys.length}
        aria-valuenow={decidedCount}
        aria-label="外键决策进度"
      >
        <div
          className={
            'absolute inset-y-0 left-0 transition-[width] duration-300 ease-out ' +
            (pendingCount === 0
              ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
              : 'bg-gradient-to-r from-indigo-400 to-indigo-500')
          }
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Compact top toolbar: status summary + 3 batch actions as icon
          buttons. Replaces the previous full-width text-button row that was
          duplicated again inside every confidence group. */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-ink-100 dark:border-inkd-300 bg-ink-50/40 dark:bg-inkd-200/40">
        <span className="text-[11px] text-ink-500 dark:text-inkd-600 tabular-nums leading-tight flex flex-col">
          {pendingCount > 0 ? (
            <>
              <span>
                <span className="text-ink-800 dark:text-inkd-800 font-semibold text-[12.5px]">
                  {decidedCount}
                </span>
                <span className="text-ink-300 dark:text-inkd-500"> / </span>
                <span className="text-ink-600 dark:text-inkd-700">{allKeys.length}</span>
                <span className="text-ink-400 dark:text-inkd-500 ml-1">已决策</span>
              </span>
              <span className="text-[10px] text-ink-400 dark:text-inkd-500 mt-px">
                还剩 {pendingCount} 条待审
              </span>
            </>
          ) : (
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              ✓ 全部 {decidedCount} 条候选已审完
            </span>
          )}
        </span>
        <span className="flex items-center gap-1" role="group" aria-label="批量操作">
          <IconBtn
            kind="accept"
            title="全部接受（虚线变实线）"
            onClick={() => batchDecide(allKeys, 'accept')}
          />
          <IconBtn
            kind="reject"
            title="全部拒绝（从画布上消失）"
            onClick={() => batchDecide(allKeys, 'reject')}
          />
          <IconBtn kind="clear" title="清除所有决策（恢复虚线默认）" onClick={resetDecisions} />
        </span>
      </div>

      <div>
        {visibleConfs.map((conf) => (
          <Group
            key={conf}
            confidence={conf}
            open={openGroups[conf]}
            onToggle={() => setOpenGroups((s) => ({ ...s, [conf]: !s[conf] }))}
            items={groups[conf]}
            decisions={decisions}
            onAccept={acceptFk}
            onReject={rejectFk}
            onClear={(k) => batchClear([k])}
          />
        ))}
      </div>

      <div className="px-3 py-1.5 border-t border-ink-100 dark:border-inkd-300 flex items-center justify-between text-[11px] text-ink-400 dark:text-inkd-500">
        <span className="tabular-nums">共 {inferred.length} 条候选</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="accent-ink-700 dark:accent-inkd-700"
            checked={showLow}
            onChange={() => toggleDisplay('showLowConfidence')}
          />
          显示低置信度边
        </label>
      </div>
    </div>
  );
}

const CONF_META: Record<Confidence, { label: string; dot: string; bar: string; tone: string }> = {
  // dot   = filled circle in the group header (3 × 3 px-ish)
  // bar   = vertical color stripe on the left of each FK row (3px wide)
  // tone  = subtle tint applied to the row's left side for extra signal
  high: {
    label: '高',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-400',
    tone: 'before:bg-emerald-400/70',
  },
  medium: { label: '中', dot: 'bg-amber-500', bar: 'bg-amber-400', tone: 'before:bg-amber-400/70' },
  low: { label: '低', dot: 'bg-rose-500', bar: 'bg-rose-400', tone: 'before:bg-rose-400/70' },
};

interface GroupProps {
  confidence: Confidence;
  open: boolean;
  onToggle: () => void;
  items: InferredFK[];
  decisions: Record<string, 'accept' | 'reject'>;
  onAccept: (key: string) => void;
  onReject: (key: string) => void;
  onClear: (key: string) => void;
}

function Group({
  confidence,
  open,
  onToggle,
  items,
  decisions,
  onAccept,
  onReject,
  onClear,
}: GroupProps) {
  if (items.length === 0) return null;
  const meta = CONF_META[confidence];
  // How many in this group are still undecided — surfaced in the header so
  // the user knows where work remains without expanding the group.
  const pending = items.reduce((n, fk) => (decisions[fkKey(fk)] ? n : n + 1), 0);

  return (
    <div className="border-b border-ink-100 dark:border-inkd-300 last:border-b-0">
      <button
        type="button"
        className={
          'w-full flex items-center gap-2 px-3 h-7 text-left transition-colors ' +
          'hover:bg-ink-50 dark:hover:bg-inkd-200'
        }
        onClick={onToggle}
        aria-expanded={open}
      >
        <Chevron open={open} />
        <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + meta.dot} aria-hidden />
        <span className="text-[12px] text-ink-700 dark:text-inkd-700 font-medium">
          {meta.label}置信度
        </span>
        <span className="text-[11px] text-ink-400 dark:text-inkd-500 tabular-nums">
          {items.length}
        </span>
        {pending > 0 && (
          <span className="ml-auto text-[10.5px] text-ink-400 dark:text-inkd-500 tabular-nums">
            {pending} 待定
          </span>
        )}
      </button>

      {open && (
        <ul className="bg-white dark:bg-inkd-100">
          {items.map((fk) => (
            <FkRow
              key={fkKey(fk)}
              fk={fk}
              decision={decisions[fkKey(fk)]}
              bar={meta.bar}
              onAccept={() => onAccept(fkKey(fk))}
              onReject={() => onReject(fkKey(fk))}
              onClear={() => onClear(fkKey(fk))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface FkRowProps {
  fk: InferredFK;
  decision: 'accept' | 'reject' | undefined;
  bar: string;
  onAccept: () => void;
  onReject: () => void;
  onClear: () => void;
}

function FkRow({ fk, decision, bar, onAccept, onReject, onClear }: FkRowProps) {
  const accepted = decision === 'accept';
  const rejected = decision === 'reject';
  const tokens = useMemo(() => tokenizeReason(fk.reason), [fk.reason]);
  // The full FK path goes into a `title` so hovering shows the untruncated
  // string even when the rendered text is ellipsized for long names.
  const pathStr = `${fk.fromTable}.${fk.fromColumns.join(',')} → ${fk.toTable}.${fk.toColumns.join(',')}`;

  return (
    <li
      className={
        'group relative pl-3 pr-2 py-1.5 border-b border-ink-100/70 dark:border-inkd-300/70 last:border-b-0 ' +
        (rejected ? 'opacity-55' : '')
      }
      title={`${pathStr}\n\n${fk.reason}`}
    >
      {/* Left confidence stripe: a 2.5px bar flush with the row's left edge.
          Drawn as a sibling element so we can keep the row's text padding
          predictable. */}
      <span
        className={
          'absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ' +
          (accepted ? 'bg-emerald-500' : rejected ? 'bg-rose-400' : bar)
        }
        aria-hidden
      />
      <div className="flex items-center gap-2 min-w-0">
        <StateIcon decision={decision} />
        <code
          className={
            'font-mono text-[11.5px] truncate flex-1 ' +
            (rejected
              ? 'text-ink-400 dark:text-inkd-500 line-through'
              : accepted
                ? 'text-ink-700 dark:text-inkd-700'
                : 'text-ink-800 dark:text-inkd-800')
          }
        >
          <span className="text-ink-800 dark:text-inkd-800">{fk.fromTable}</span>
          <span className="text-ink-500 dark:text-inkd-600">.{fk.fromColumns.join(',')}</span>
          <span className="text-ink-300 dark:text-inkd-500 mx-0.5">→</span>
          <span className="text-ink-800 dark:text-inkd-800">{fk.toTable}</span>
          <span className="text-ink-500 dark:text-inkd-600">.{fk.toColumns.join(',')}</span>
        </code>
        <span className="flex items-center gap-0.5 shrink-0">
          <RowToggleBtn kind="accept" active={accepted} onClick={accepted ? onClear : onAccept} />
          <RowToggleBtn kind="reject" active={rejected} onClick={rejected ? onClear : onReject} />
        </span>
      </div>
      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5 pl-[22px]">
          {tokens.map((t) => (
            <span
              key={t.id}
              className={
                'text-[9.5px] px-1 py-px rounded font-medium tabular-nums ' + TOKEN_STYLES[t.tone]
              }
              title={t.title}
            >
              {t.text}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Reason tokenization
// -----------------------------------------------------------------------------

interface ReasonToken {
  /** Unique key for React. */
  id: string;
  /** Short label rendered in the chip. */
  text: string;
  /** Long form shown on chip hover. */
  title: string;
  tone: 'good' | 'warn' | 'info';
}

const TOKEN_STYLES: Record<ReasonToken['tone'], string> = {
  good: 'bg-emerald-50 text-emerald-700 border border-emerald-200/70 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/40',
  warn: 'bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40',
  info: 'bg-ink-50 text-ink-600 border border-ink-100 dark:bg-inkd-200 dark:text-inkd-700 dark:border-inkd-300',
};

/**
 * Turn an inference reason string into 1–3 compact chips. The exact reason
 * messages come from {@link infer/inferForeignKeys.ts}; we recognize a small
 * set and fall back to one info chip with the raw reason for anything new.
 */
function tokenizeReason(reason: string): ReasonToken[] {
  const out: ReasonToken[] = [];
  // Name-matching dimension.
  if (/Exact name match/i.test(reason)) {
    out.push({
      id: 'name-exact',
      text: '名·精确',
      title: '列名与目标主键名完全一致',
      tone: 'good',
    });
  } else if (/prefix normalization/i.test(reason)) {
    out.push({
      id: 'name-prefix',
      text: '名·前缀',
      title: '列名经过前缀归一化后匹配',
      tone: 'info',
    });
  } else if (/Compound prefix fallback/i.test(reason)) {
    out.push({
      id: 'name-compound',
      text: '名·复合',
      title: '复合前缀匹配（兜底策略）',
      tone: 'info',
    });
  } else if (/Multiple targets matched/i.test(reason)) {
    out.push({
      id: 'name-multi',
      text: '名·多解',
      title: '多个候选目标，已挑选最佳',
      tone: 'warn',
    });
  }
  // Type compatibility.
  if (/types compatible/i.test(reason)) {
    out.push({
      id: 'type-ok',
      text: '类型·兼容',
      title: '源列与目标列类型可兼容',
      tone: 'good',
    });
  }
  // Index dimension.
  if (/source column indexed/i.test(reason) || /indexed=true/i.test(reason)) {
    out.push({
      id: 'idx-yes',
      text: '索引·是',
      title: '源列已建索引（FK 性能更好）',
      tone: 'good',
    });
  } else if (/no index on source column/i.test(reason) || /indexed=false/i.test(reason)) {
    out.push({
      id: 'idx-no',
      text: '索引·无',
      title: '源列没有索引（建议补一个）',
      tone: 'warn',
    });
  }
  if (out.length === 0) {
    // Fallback for any reason we don't recognize.
    out.push({ id: 'raw', text: reason, title: reason, tone: 'info' });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Tiny icon/button components
// -----------------------------------------------------------------------------

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={
        'shrink-0 text-ink-400 dark:text-inkd-500 transition-transform duration-150 ' +
        (open ? 'rotate-90' : '')
      }
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StateIcon({ decision }: { decision: 'accept' | 'reject' | undefined }) {
  if (decision === 'accept') {
    return (
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500 text-white shrink-0"
        aria-label="已接受"
      >
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8.5l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (decision === 'reject') {
    return (
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-rose-500 text-white shrink-0"
        aria-label="已拒绝"
      >
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="inline-flex w-3.5 h-3.5 rounded-full border border-ink-300 dark:border-inkd-400 shrink-0"
      aria-label="待定"
    />
  );
}

interface RowToggleBtnProps {
  kind: 'accept' | 'reject';
  active: boolean;
  onClick: () => void;
}

function RowToggleBtn({ kind, active, onClick }: RowToggleBtnProps) {
  // When the row is already in this state, the button title flips to "撤销"
  // and clicking clears the decision (the parent passes onClear in that
  // case). The icon stays the same so the user always sees the affordance.
  const isAccept = kind === 'accept';
  const base = 'inline-flex items-center justify-center w-5 h-5 rounded transition-colors';
  const colorClass = active
    ? isAccept
      ? 'bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500'
      : 'bg-rose-500 text-white hover:bg-rose-600 dark:bg-rose-600 dark:hover:bg-rose-500'
    : isAccept
      ? 'text-ink-400 dark:text-inkd-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-300'
      : 'text-ink-400 dark:text-inkd-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 hover:text-rose-600 dark:hover:text-rose-300';
  const title = active ? '点击撤销' : isAccept ? '接受 (虚线变实线)' : '拒绝 (从画布上消失)';
  return (
    <button type="button" className={base + ' ' + colorClass} title={title} onClick={onClick}>
      {isAccept ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8.5l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

function IconBtn({
  kind,
  title,
  onClick,
}: {
  kind: 'accept' | 'reject' | 'clear';
  title: string;
  onClick: () => void;
}) {
  const base =
    'inline-flex items-center justify-center w-6 h-6 rounded transition-colors text-[10px]';
  const palette: Record<typeof kind, string> = {
    accept:
      'text-emerald-700 hover:bg-emerald-50 border border-emerald-200/70 dark:text-emerald-300 dark:hover:bg-emerald-900/30 dark:border-emerald-700/40',
    reject:
      'text-rose-700 hover:bg-rose-50 border border-rose-200/70 dark:text-rose-300 dark:hover:bg-rose-900/30 dark:border-rose-700/40',
    clear:
      'text-ink-500 hover:bg-ink-50 border border-ink-200 dark:text-inkd-600 dark:hover:bg-inkd-200 dark:border-inkd-300',
  };
  return (
    <button type="button" className={base + ' ' + palette[kind]} title={title} onClick={onClick}>
      {kind === 'accept' && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8.5l3 3 7-7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {kind === 'reject' && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
      {kind === 'clear' && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 8a4 4 0 1 1 1.2 2.83M4 4v3.5h3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
