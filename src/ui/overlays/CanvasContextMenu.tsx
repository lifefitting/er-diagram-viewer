import { useEffect, useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';
import { getView } from '../../diagram/cyHandle';
import { useApp } from '../../store';

const MENU_WIDTH = 192;
const MENU_HEIGHT = 156;
const VIEWPORT_GAP = 8;

export interface CanvasContextMenuPosition {
  x: number;
  y: number;
}

export function CanvasContextMenu({
  position,
  onClose,
}: {
  position: CanvasContextMenuPosition;
  onClose: () => void;
}) {
  const showGrid = useApp((state) => state.display.showGrid);
  const toggleDisplay = useApp((state) => state.toggleDisplay);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the menu itself before paint: keyboard input works immediately, but
  // no command receives the highlighted "selected" treatment on open.
  useLayoutEffect(() => {
    menuRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnWindowChange = () => onClose();
    document.addEventListener('mousedown', closeOutside);
    window.addEventListener('blur', closeOnWindowChange);
    window.addEventListener('resize', closeOnWindowChange);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      window.removeEventListener('blur', closeOnWindowChange);
      window.removeEventListener('resize', closeOnWindowChange);
    };
  }, [onClose]);

  const left = Math.max(
    VIEWPORT_GAP,
    Math.min(position.x, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP),
  );
  const top = Math.max(
    VIEWPORT_GAP,
    Math.min(position.y, window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP),
  );
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const moveFocus = (direction: 1 | -1) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      current < 0
        ? direction > 0
          ? 0
          : items.length - 1
        : (current + direction + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      data-testid="canvas-context-menu"
      role="menu"
      aria-label="画布右键菜单"
      tabIndex={-1}
      className={clsx(
        'fixed z-50 w-48 rounded-md border py-0.5 shadow-lg outline-none',
        'border-ink-200 bg-white dark:border-inkd-300 dark:bg-inkd-100',
      )}
      style={{ left, top }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        const command = event.metaKey || event.ctrlKey;
        if (command && event.key === '0') {
          event.preventDefault();
          getView()?.resetZoom();
          onClose();
        } else if (!command && event.shiftKey && event.code === 'Digit1') {
          event.preventDefault();
          getView()?.fit();
          onClose();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(-1);
        }
      }}
    >
      <ContextMenuItem label="放大" onClick={run(() => getView()?.zoomStep(1))} />
      <ContextMenuItem label="缩小" onClick={run(() => getView()?.zoomStep(-1))} />
      <ContextMenuItem
        label="缩放至 100%"
        shortcut="⌘ 0"
        onClick={run(() => getView()?.resetZoom())}
      />
      <ContextMenuItem label="画布全览" shortcut="Shift 1" onClick={run(() => getView()?.fit())} />
      <div className="my-1 h-px bg-ink-100 dark:bg-inkd-300" role="separator" />
      <ContextMenuItem
        label={showGrid ? '隐藏网格' : '显示网格'}
        onClick={run(() => toggleDisplay('showGrid'))}
      />
    </div>
  );
}

function ContextMenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center justify-between gap-5 px-3 py-1.5 text-left text-xs text-ink-700 outline-none hover:bg-ink-50 focus:bg-sky-50 focus:text-sky-700 dark:text-inkd-700 dark:hover:bg-inkd-200 dark:focus:bg-sky-500/10 dark:focus:text-sky-300"
      onClick={onClick}
    >
      <span>{label}</span>
      {shortcut && (
        <kbd className="shrink-0 text-[10px] font-normal text-ink-400 dark:text-inkd-500">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
