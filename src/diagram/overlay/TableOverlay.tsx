import clsx from 'clsx';
import type { DisplayOptions } from '../../store';
import type { NodePos, OverlayState } from '../types';
import { ColumnRow } from './ColumnRow';
import { TableHeader } from './TableHeader';
import { highlightMatch } from './highlight';

interface TableOverlayProps {
  pos: NodePos;
  display: DisplayOptions;
  state: OverlayState;
  collapsed: boolean;
  flashing: boolean;
  /** Set of columns acting as FK source in the current effective FK list. */
  fkColumns: Set<string> | undefined;
  /** True if the user has dragged this card's width manually. */
  hasManualWidth: boolean;
  /** Member of the explicit multi-select group (drags together; sky ring). */
  selected?: boolean;
  /** The current search match the canvas is centered on (find navigation) —
   *  gets a stronger ring so "which one now" is obvious among the matches. */
  activeMatch?: boolean;
  /** When false (pan/hand mode), the card ignores pointer events so a drag pans
   *  the canvas instead of moving the card. */
  interactive?: boolean;
  /** Active search query; matching substrings in name/comment/columns get a
   *  yellow find-highlight. */
  query?: string;
  onDragHandle: (e: React.MouseEvent) => void;
  onResizeHandle: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
  onResetWidth: () => void;
  /** Start a drag-to-connect manual relation from one of this table's columns
   *  (`side` = which connect dot was grabbed). */
  onConnectStart?: (colName: string, side: 'left' | 'right', e: React.MouseEvent) => void;
  /** Columns of this table that carry a review note (评审批注). */
  noteColumns?: Set<string>;
  /** Click on a field row: open its review-note bubble. */
  onOpenNote?: (colName: string, e: React.MouseEvent) => void;
}

/**
 * The HTML card rendered on top of each cytoscape table node. Synced in
 * position/size by the canvas; here we only render the contents and translate
 * a couple of pointer interactions into callbacks (drag header = move, drag
 * right edge = resize, click chevron = collapse, dbl-click right edge = reset
 * width).
 */
export function TableOverlay({
  pos,
  display,
  state,
  collapsed,
  flashing,
  fkColumns,
  hasManualWidth,
  selected = false,
  activeMatch = false,
  interactive = true,
  query = '',
  onDragHandle,
  onResizeHandle,
  onToggleCollapse,
  onResetWidth,
  onConnectStart,
  noteColumns,
  onOpenNote,
}: TableOverlayProps) {
  const { table, x, y, w, h, moduleColor } = pos;
  // The active find-match gets the strongest ring + a glow so it stands out
  // among the other (amber) matches; otherwise amber focus/search match wins
  // over the sky multi-select ring. Dim opacity is independent, so a dimmed
  // card can still show it's in the drag group.
  const ring = activeMatch
    ? 'ring-4 ring-amber-500 shadow-amber-500/40 z-10'
    : flashing || state === 'match'
      ? 'ring-2 ring-amber-500'
      : selected
        ? 'ring-2 ring-sky-500'
        : '';
  const dimOpacity = state === 'dim' ? 'opacity-25' : '';
  const visibleColumns = collapsed
    ? []
    : display.onlyPk
      ? table.columns.filter((c) => c.isPrimaryKey || table.primaryKey.includes(c.name))
      : table.columns;

  return (
    <div
      className={clsx(
        'absolute rounded-md shadow-md pointer-events-auto select-none overflow-hidden transition-opacity',
        // Light mode uses pure white so module border tinting reads clearly;
        // dark mode uses the elevated-surface color (inkd-100) so it doesn't
        // get lost on the inkd-50 page background.
        'bg-white dark:bg-inkd-100',
        ring,
        dimOpacity,
      )}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        border: `1px solid ${moduleColor.border}`,
        // In pan mode the card is click-through so a drag pans the canvas
        // instead of grabbing the card (overrides the pointer-events-auto class).
        ...(interactive ? null : { pointerEvents: 'none' as const }),
      }}
    >
      <TableHeader
        table={table}
        moduleKey={pos.moduleKey}
        moduleColor={moduleColor}
        collapsed={collapsed}
        query={query}
        onDragHandle={onDragHandle}
        onToggleCollapse={onToggleCollapse}
      />
      {!collapsed && table.comment && table.comment.trim() && (
        <div
          className={clsx(
            'text-[10.5px] italic px-2 py-[2px] truncate',
            'text-ink-400 dark:text-inkd-500',
            'border-b border-ink-100 dark:border-inkd-300',
          )}
          style={{ height: 18 }}
          title={table.comment}
        >
          {highlightMatch(table.comment, query)}
        </div>
      )}
      {!collapsed && (
        <div className="text-[12px]">
          {visibleColumns.map((c) => (
            <ColumnRow
              key={c.name}
              col={c}
              table={table}
              showType={display.showType}
              showIndex={display.showIndex}
              showComment={display.showComment}
              isFk={fkColumns?.has(c.name) ?? false}
              query={query}
              onConnectStart={onConnectStart && ((side, e) => onConnectStart(c.name, side, e))}
              hasNote={noteColumns?.has(c.name) ?? false}
              onOpenNote={onOpenNote && ((e) => onOpenNote(c.name, e))}
            />
          ))}
        </div>
      )}
      {/* Right-edge resize handle. Wider hit area (8px) than visual (2px) so
          it's easy to grab. Double-click resets the algorithmic width. */}
      {!collapsed && (
        <div
          className="absolute top-0 right-0 h-full cursor-ew-resize group"
          style={{ width: 8 }}
          onMouseDown={onResizeHandle}
          onDoubleClick={(e) => {
            if (!hasManualWidth) return;
            e.stopPropagation();
            onResetWidth();
          }}
          title={hasManualWidth ? '拖动调整宽度 · 双击恢复自动宽度' : '拖动调整宽度'}
        >
          {/* 视觉提示条只在 hover 时显示——之前 hasManualWidth 时持久渲染
              一根 2px rounded-full 细条，远看像 card 右侧贴了一段虚线残影。
              手动宽度的状态信息改由 title tooltip 表达（双击恢复算法宽度）。*/}
          <div
            className={clsx(
              'absolute top-2 bottom-2 right-[2px] rounded-full transition-colors',
              'bg-transparent group-hover:bg-ink-400/30 dark:group-hover:bg-inkd-500/40',
            )}
            style={{ width: 2 }}
          />
        </div>
      )}
    </div>
  );
}
