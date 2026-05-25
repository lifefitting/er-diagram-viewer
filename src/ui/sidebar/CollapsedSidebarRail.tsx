import clsx from 'clsx';
import { SidebarOpenIcon, SparklesIcon } from './icons';

/**
 * Collapsed-state rail. A narrow vertical strip pinned to the top-left,
 * exposing both an "open" affordance and the sparkles brand mark so the
 * user always sees the panel exists. Click anywhere to expand.
 */
export function CollapsedSidebarRail({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      className={clsx(
        'absolute left-3 top-3 z-30 group',
        'inline-flex items-center gap-1.5 h-9 pl-2 pr-2.5',
        'rounded-md border border-ink-100 dark:border-inkd-300',
        'bg-white/95 dark:bg-inkd-100/95 backdrop-blur',
        'shadow-md hover:shadow-lg transition-all',
        'hover:bg-white dark:hover:bg-inkd-200',
      )}
      onClick={onExpand}
      title="展开智能面板"
    >
      <span
        className={clsx(
          'inline-flex items-center justify-center h-6 w-6 rounded',
          'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white',
        )}
        aria-hidden
      >
        <SparklesIcon size={12} />
      </span>
      <span className="text-[11.5px] font-medium text-ink-700 dark:text-inkd-700 group-hover:text-ink-900 dark:group-hover:text-inkd-900">
        智能面板
      </span>
      <span className="text-ink-300 dark:text-inkd-500 group-hover:text-ink-500 dark:group-hover:text-inkd-700 transition-colors">
        <SidebarOpenIcon />
      </span>
    </button>
  );
}
