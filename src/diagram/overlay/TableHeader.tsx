import type { Table } from '../../parser/types';
import type { ModuleColor } from '../../infer/inferModules';
import { HEADER_HEIGHT } from '../buildGraph';
import { highlightMatch } from './highlight';

interface TableHeaderProps {
  table: Table;
  moduleKey: string;
  moduleColor: ModuleColor;
  collapsed: boolean;
  query?: string;
  onDragHandle: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
  /** Record a table-level 建议删除 decision and hide the card. */
  onMarkDelete?: () => void;
}

export function TableHeader({
  table,
  moduleKey,
  moduleColor,
  collapsed,
  query = '',
  onDragHandle,
  onToggleCollapse,
  onMarkDelete,
}: TableHeaderProps) {
  const shardInfo = table.shardInfo;
  return (
    <div
      className="group flex items-center gap-1.5 text-[13px] font-semibold px-2 cursor-grab active:cursor-grabbing"
      style={{
        background: moduleColor.header,
        color: moduleColor.text,
        height: HEADER_HEIGHT,
      }}
      onMouseDown={onDragHandle}
      title={`模块: ${moduleKey || '未分类'} · 拖动调整位置`}
    >
      <button
        type="button"
        className="hover:bg-white/15 rounded px-0.5 -ml-0.5 text-[10px] leading-none flex items-center justify-center w-4 h-4 shrink-0"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
        title={collapsed ? '展开表' : '折叠表'}
        aria-label={collapsed ? '展开表' : '折叠表'}
      >
        {collapsed ? '▸' : '▾'}
      </button>
      <span className="truncate flex-1 min-w-0" title={table.name}>
        {highlightMatch(table.name, query)}
      </span>
      {shardInfo && (
        <span
          className="text-[9px] font-medium px-1 py-[1px] rounded bg-white/25 border border-white/30 shrink-0 whitespace-nowrap"
          title={`合并的分表 (${shardInfo.shards.length}):\n${shardInfo.shards.join('\n')}`}
        >
          shards: {shardInfo.shards.length}
        </span>
      )}
      {moduleKey && (
        <span
          className="text-[10px] opacity-80 font-normal whitespace-nowrap shrink-0"
          title={moduleKey}
        >
          {moduleKey}
        </span>
      )}
      {onMarkDelete && (
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/20 focus:opacity-100 group-hover:opacity-100"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMarkDelete();
          }}
          title="标记此表为建议删除"
          aria-label={`标记 ${table.name} 为建议删除`}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 4h10M6 4V2.5h4V4m-5.5 0 .6 9h5.8l.6-9M6.8 6.5v4M9.2 6.5v4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
