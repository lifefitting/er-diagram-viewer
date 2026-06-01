import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Core } from 'cytoscape';
import { getCy, getView, relayoutCurrent } from '../../diagram/cyHandle';
import { useApp } from '../../store';
import { MinusIcon, PlusIcon, HelpIcon, HandIcon, UndoIcon, RedoIcon } from './icons';

/**
 * Floating canvas controls, bottom-right over the diagram, as three independent
 * rounded pills: [undo · redo] · [hand · − · zoom% · +] · [help]. The live zoom
 * % opens a "view" popover (缩放至100% / 全览 / 缩放到选中 + 重置布局 / 全屏).
 *
 * Reactive state (canvasMode, canUndo/canRedo) comes from the store so buttons
 * grey/highlight correctly; the imperative view + history actions go through the
 * `cyHandle` module so cytoscape stays out of the main bundle.
 */

// Fixed zoom ladder so +/- snap to clean, predictable stops (the upper half
// — 100/125/150/200/250/300/400 — is the sequence the design calls for; the
// lower stops cover zoom-out). Pinch/⌘-wheel zoom stays continuous; only the
// buttons snap.
const ZOOM_STOPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

/** Step to the next ladder stop above (dir>0) or below (dir<0) the current zoom,
 *  keeping the viewport center fixed. Snaps an off-ladder zoom (e.g. a pinch to
 *  144%) onto the ladder in the chosen direction. */
function zoomStep(dir: 1 | -1): void {
  const cy = getCy<Core>();
  if (!cy) return;
  const z = cy.zoom();
  const eps = 0.001;
  const next =
    dir > 0
      ? (ZOOM_STOPS.find((s) => s > z + eps) ?? ZOOM_STOPS[ZOOM_STOPS.length - 1])
      : ([...ZOOM_STOPS].reverse().find((s) => s < z - eps) ?? ZOOM_STOPS[0]);
  cy.zoom({ level: next, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
}

const PILL =
  'flex items-center rounded-full px-1 ' +
  'border border-ink-200 dark:border-inkd-300 ' +
  'bg-white/90 dark:bg-inkd-100/90 backdrop-blur shadow-lg';

export function CanvasControls() {
  const canvasMode = useApp((s) => s.canvasMode);
  const toggleCanvasMode = useApp((s) => s.toggleCanvasMode);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);

  const [openPopover, setOpenPopover] = useState<'help' | 'zoom' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Live zoom %. The canvas is lazy, so cy (and the bound view) may not exist
  // yet — poll getView() until bound, then subscribe to its zoom changes. Every
  // zoom path (buttons, popover, wheel) goes through cy.zoom/fit which fires the
  // 'zoom' event, so the readout stays in sync for free.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const attach = () => {
      const view = getView();
      if (!view) return false;
      const update = () => setZoomPct(Math.round(view.getZoom() * 100));
      update();
      unsub = view.onZoomChange(update);
      return true;
    };
    if (attach()) return () => unsub?.();
    const id = window.setInterval(() => {
      if (attach()) window.clearInterval(id);
    }, 250);
    return () => {
      window.clearInterval(id);
      unsub?.();
    };
  }, []);

  // Close whichever popover is open on outside click or Escape.
  useEffect(() => {
    if (!openPopover) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPopover]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2" ref={rootRef}>
      {/* Pill 1 — undo / redo */}
      <div className={PILL} role="toolbar" aria-label="撤销重做">
        <PillButton onClick={undo} disabled={!canUndo} title="撤销 (⌘Z)" ariaLabel="撤销">
          <UndoIcon />
        </PillButton>
        <PillDivider />
        <PillButton onClick={redo} disabled={!canRedo} title="重做 (⌘⇧Z)" ariaLabel="重做">
          <RedoIcon />
        </PillButton>
      </div>

      {/* Pill 2 — hand tool + zoom (relative so the view popover anchors here) */}
      <div className="relative">
        {openPopover === 'zoom' && (
          <ViewMenu isFullscreen={isFullscreen} onFullscreen={toggleFullscreen} onClose={() => setOpenPopover(null)} />
        )}
        <div className={PILL} role="toolbar" aria-label="缩放与平移">
          <PillButton
            onClick={toggleCanvasMode}
            active={canvasMode === 'pan'}
            title="抓手工具（拖拽平移）"
            ariaLabel="抓手工具"
          >
            <HandIcon />
          </PillButton>
          <PillDivider />
          <PillButton onClick={() => zoomStep(-1)} title="缩小" ariaLabel="缩小">
            <MinusIcon />
          </PillButton>
          <button
            type="button"
            className="h-9 min-w-[3.25rem] rounded-full px-1 text-[12px] font-medium tabular-nums text-ink-700 transition-colors hover:bg-ink-50 dark:text-inkd-700 dark:hover:bg-inkd-200"
            onClick={() => setOpenPopover((p) => (p === 'zoom' ? null : 'zoom'))}
            aria-haspopup="menu"
            aria-expanded={openPopover === 'zoom'}
            title="缩放选项"
          >
            {zoomPct}%
          </button>
          <PillButton onClick={() => zoomStep(1)} title="放大" ariaLabel="放大">
            <PlusIcon />
          </PillButton>
        </div>
      </div>

      {/* Pill 3 — help (relative so the help popover anchors here) */}
      <div className="relative">
        {openPopover === 'help' && <HelpPopover />}
        <div className={PILL}>
          <PillButton
            onClick={() => setOpenPopover((p) => (p === 'help' ? null : 'help'))}
            active={openPopover === 'help'}
            title="操作帮助"
            ariaLabel="操作帮助"
          >
            <HelpIcon />
          </PillButton>
        </div>
      </div>
    </div>
  );
}

function ViewMenu({
  isFullscreen,
  onFullscreen,
  onClose,
}: {
  isFullscreen: boolean;
  onFullscreen: () => void;
  onClose: () => void;
}) {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div
      className={clsx(
        'absolute bottom-full right-0 mb-2 w-56 rounded-lg py-1',
        'border border-ink-200 dark:border-inkd-300',
        'bg-white/95 dark:bg-inkd-100/95 backdrop-blur shadow-xl',
      )}
      role="menu"
      aria-label="视图选项"
    >
      <MenuRow onClick={run(() => getView()?.resetZoom())} label="缩放至 100%" keys={['⌘', '0']} />
      <MenuRow onClick={run(() => getView()?.fit())} label="全览" keys={['Shift', '1']} />
      <MenuRow onClick={run(() => getView()?.zoomToSelection())} label="缩放到选中" keys={['Shift', '2']} />
      <div className="my-1 h-px bg-ink-100 dark:bg-inkd-300" />
      <MenuRow onClick={run(() => relayoutCurrent())} label="重置布局" />
      <MenuRow onClick={run(onFullscreen)} label={isFullscreen ? '退出全屏' : '全屏'} />
    </div>
  );
}

function MenuRow({ onClick, label, keys }: { onClick: () => void; label: string; keys?: string[] }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-[12.5px] text-ink-700 transition-colors hover:bg-ink-50 dark:text-inkd-700 dark:hover:bg-inkd-200"
    >
      <span>{label}</span>
      {keys && (
        <span className="flex items-center gap-1">
          {keys.map((k, i) => (
            <kbd
              key={i}
              className="inline-block min-w-[1.1rem] rounded border border-ink-200 bg-ink-50 px-1 py-px text-center text-[10px] font-medium text-ink-400 dark:border-inkd-400 dark:bg-inkd-200 dark:text-inkd-500"
            >
              {k}
            </kbd>
          ))}
        </span>
      )}
    </button>
  );
}

function HelpPopover() {
  return (
    <div
      className={clsx(
        'absolute bottom-full right-0 mb-2 w-64 rounded-lg p-3',
        'border border-ink-200 dark:border-inkd-300',
        'bg-white/95 dark:bg-inkd-100/95 backdrop-blur shadow-xl',
      )}
      role="dialog"
      aria-label="画布操作帮助"
    >
      <div className="mb-2 text-[12px] font-semibold text-ink-800 dark:text-inkd-800">画布操作</div>
      <ul className="space-y-1.5">
        <HelpRow keys="拖拽空白">框选多张表（选择模式）</HelpRow>
        <HelpRow keys="抓手 / 空格 / 中键">拖拽平移画布</HelpRow>
        <HelpRow keys="拖拽表头">移动卡片（多选时整组移动）</HelpRow>
        <HelpRow keys="⇧ / ⌘ 点击">加选 / 取消单张</HelpRow>
        <HelpRow keys="滚轮 / 双指">平移 · 捏合或 ⌘ 滚轮缩放</HelpRow>
        <HelpRow keys="⌘Z / ⌘⇧Z">撤销 / 重做</HelpRow>
        <HelpRow keys="Esc">取消选择</HelpRow>
      </ul>
    </div>
  );
}

function HelpRow({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2 text-[11.5px] text-ink-600 dark:text-inkd-700">
      <span className="shrink-0 whitespace-nowrap rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-500 dark:border-inkd-400 dark:bg-inkd-200 dark:text-inkd-600">
        {keys}
      </span>
      <span className="leading-tight">{children}</span>
    </li>
  );
}

function PillDivider() {
  return <div className="mx-0.5 my-2 w-px self-stretch bg-ink-100 dark:bg-inkd-300" aria-hidden />;
}

function PillButton({
  onClick,
  title,
  ariaLabel,
  active,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors',
        disabled
          ? 'pointer-events-none text-ink-400 opacity-40 dark:text-inkd-500'
          : active
            ? 'bg-ink-100 text-ink-800 dark:bg-inkd-300 dark:text-inkd-800'
            : 'text-ink-600 hover:bg-ink-50 hover:text-ink-800 active:bg-ink-100 dark:text-inkd-600 dark:hover:bg-inkd-200 dark:hover:text-inkd-800 dark:active:bg-inkd-300',
      )}
    >
      {children}
    </button>
  );
}
