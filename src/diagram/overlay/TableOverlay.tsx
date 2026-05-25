import clsx from 'clsx';
import type { DisplayOptions } from '../../store';
import type { NodePos, OverlayState } from '../types';
import { ColumnRow } from './ColumnRow';
import { TableHeader } from './TableHeader';

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
  onDragHandle: (e: React.MouseEvent) => void;
  onResizeHandle: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
  onResetWidth: () => void;
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
  onDragHandle,
  onResizeHandle,
  onToggleCollapse,
  onResetWidth,
}: TableOverlayProps) {
  const { table, x, y, w, h, moduleColor } = pos;
  const ringClass =
    flashing || state === 'match' ? 'ring-2 ring-amber-500' : state === 'dim' ? 'opacity-25' : '';
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
        ringClass,
      )}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        border: `1px solid ${moduleColor.border}`,
      }}
    >
      <TableHeader
        table={table}
        moduleKey={pos.moduleKey}
        moduleColor={moduleColor}
        collapsed={collapsed}
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
          {table.comment}
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
