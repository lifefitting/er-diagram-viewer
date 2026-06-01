import clsx from 'clsx';
import type { Column, Table } from '../../parser/types';
import { columnRoleBadge, FIELD_ROW_HEIGHT, shortType } from '../buildGraph';
import { highlightMatch } from './highlight';

interface ColumnRowProps {
  col: Column;
  table: Table;
  showType: boolean;
  showIndex: boolean;
  showComment: boolean;
  isFk: boolean;
  query?: string;
}

/**
 * One field row. Renders either 1 line (name + type) or 2 lines (name + type
 * + comment beneath) depending on `showComment` + whether this column has a
 * comment. Field/type are `whitespace-nowrap` + `text-ellipsis` so they NEVER
 * wrap — overflow is communicated via the row's `title` tooltip instead.
 *
 * Badge column packs PK/FK side-by-side so a column that is both a primary
 * key AND a foreign key shows `PK FK` instead of dropping one badge.
 */
export function ColumnRow({
  col,
  table,
  showType,
  showIndex,
  showComment,
  isFk,
  query = '',
}: ColumnRowProps) {
  const roleBadge = columnRoleBadge(col, table, showIndex);
  const isPk = roleBadge === 'PK';
  const typeText = showType ? shortType(col.rawType) : '';
  const tooltipParts: string[] = [];
  tooltipParts.push(col.name + (showType ? ` : ${col.rawType}` : ''));
  if (col.comment) tooltipParts.push(col.comment);
  if (isFk) tooltipParts.push('外键');
  if (col.isPrimaryKey || table.primaryKey.includes(col.name)) tooltipParts.push('主键');
  else if (col.isUnique) tooltipParts.push('唯一');
  if (!col.nullable) tooltipParts.push('NOT NULL');
  const tooltip = tooltipParts.join(' · ');
  return (
    <div
      className={clsx(
        'border-t border-ink-100 dark:border-inkd-300',
        // PK rows get a faint amber tint so the user can scan for the primary
        // key at a glance. The dark-mode variant is a translucent amber so it
        // sits on top of the card surface without overwhelming it.
        isPk && 'bg-amber-50/70 dark:bg-amber-900/20',
      )}
      title={tooltip}
    >
      <div
        className="flex items-center gap-2 px-2 leading-none"
        style={{ height: FIELD_ROW_HEIGHT }}
      >
        <span
          className="shrink-0 flex items-center gap-[2px]"
          style={{ width: 38 }}
          aria-hidden="true"
        >
          {roleBadge && <RoleBadge kind={roleBadge as 'PK' | 'U' | 'I'} />}
          {isFk && <FkBadge />}
        </span>
        <span
          className="text-ink-800 dark:text-inkd-800 flex-1 min-w-0 truncate"
          style={{ fontWeight: isPk ? 600 : 400 }}
        >
          {highlightMatch(col.name, query)}
        </span>
        {typeText && (
          <span
            className="text-ink-400 dark:text-inkd-500 text-[10.5px] shrink-0 whitespace-nowrap"
            title={col.rawType}
          >
            {typeText}
          </span>
        )}
      </div>
      {showComment && col.comment && (
        <div
          className={clsx(
            'text-[10.5px] italic truncate px-2 leading-none flex items-end pb-[3px]',
            'text-ink-400 dark:text-inkd-500',
          )}
          style={{ height: 14 }}
          title={col.comment}
        >
          {highlightMatch(col.comment, query)}
        </div>
      )}
    </div>
  );
}

function RoleBadge({ kind }: { kind: 'PK' | 'U' | 'I' }) {
  // Dark-mode badges use the 900-tinted background + 300 text from the same
  // Tailwind hue family so the badge keeps its semantic color but doesn't
  // glow on the dark card surface.
  const color =
    kind === 'PK'
      ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/60'
      : kind === 'U'
        ? 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-700/60'
        : 'bg-ink-100 text-ink-600 border-ink-200 dark:bg-inkd-200 dark:text-inkd-700 dark:border-inkd-300';
  return (
    <span
      className={clsx(
        'text-[8.5px] font-bold leading-none px-[3px] py-[1px] rounded border',
        color,
      )}
    >
      {kind}
    </span>
  );
}

function FkBadge() {
  return (
    <span
      className={clsx(
        'text-[8.5px] font-bold leading-none px-[3px] py-[1px] rounded border',
        'bg-sky-100 text-sky-700 border-sky-300',
        'dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700/60',
      )}
      title="外键"
    >
      FK
    </span>
  );
}
