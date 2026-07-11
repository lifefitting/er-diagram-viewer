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
  /** Mousedown on the row's connect dot: start a drag-to-connect manual
   *  relation from this column. `side` is which dot was grabbed — the rubber
   *  curve leaves the card horizontally on that side. Absent (pan mode) hides
   *  the dots. */
  onConnectStart?: (side: 'left' | 'right', e: React.MouseEvent) => void;
  /** This field has a review note (评审批注) — show the amber marker. */
  hasNote?: boolean;
  /** Click on the row: open the review-note bubble for this field. Also
   *  enables the hover highlight that signals the row is clickable. */
  onOpenNote?: (e: React.MouseEvent) => void;
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
  onConnectStart,
  hasNote = false,
  onOpenNote,
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
        'group/row relative border-t border-ink-100 dark:border-inkd-300',
        // PK rows get a faint amber tint so the user can scan for the primary
        // key at a glance. The dark-mode variant is a translucent amber so it
        // sits on top of the card surface without overwhelming it.
        isPk && 'bg-amber-50/70 dark:bg-amber-900/20',
        // Clickable-for-review affordance: rows light up on hover and open
        // the note bubble on click.
        onOpenNote && 'cursor-pointer hover:bg-sky-50/70 dark:hover:bg-sky-900/20',
      )}
      title={hasNote ? `${tooltip}\n（有评审批注，点击查看）` : tooltip}
      // Drop-target markers for the drag-to-connect gesture: the canvas finds
      // the row under the cursor via elementFromPoint + closest('[data-fk-col]').
      data-fk-table={table.name}
      data-fk-col={col.name}
      onClick={
        onOpenNote &&
        ((e) => {
          e.stopPropagation();
          onOpenNote(e);
        })
      }
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
          {hasNote && (
            <span
              className="ml-1 inline-block h-[6px] w-[6px] rounded-full bg-amber-500 align-middle"
              aria-label="有评审批注"
            />
          )}
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
      {/* Connect dots (触点): appear on row hover at BOTH edges of the name
          row — the user drags from whichever side faces the target table.
          The BUTTON is a 22px invisible hit zone (a magnetic snap radius:
          getting close is enough), the inner span is the 14px visual dot with
          the breathing halo; hovering locks the halo bright and grows the dot
          (see styles.css). The cursor is a custom "draw a line from here"
          glyph. z-10 keeps them above the card's resize strip; mousedown must
          not bubble (marquee/pan handlers live underneath). */}
      {onConnectStart &&
        (['left', 'right'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={clsx(
              'connect-dot-hit absolute z-10 flex h-[22px] w-[22px] items-center justify-center',
              'opacity-0 transition-opacity group-hover/row:opacity-100',
            )}
            style={{ [side]: -1, top: FIELD_ROW_HEIGHT / 2 - 11 }}
            title="从这里拉一条线到目标字段，建立外键 / 逻辑关联"
            aria-label={`从 ${table.name}.${col.name} 拖线建立外键（${side === 'left' ? '左' : '右'}）`}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onConnectStart(side, e);
            }}
          >
            <span
              className={clsx(
                'connect-dot flex h-[14px] w-[14px] items-center justify-center rounded-full',
                'border border-sky-500 bg-white dark:bg-inkd-100',
              )}
              aria-hidden
            >
              <span className="h-[6px] w-[6px] rounded-full bg-sky-500" />
            </span>
          </button>
        ))}
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
