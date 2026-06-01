import { useState, type ReactNode } from 'react';

/**
 * A single collapsible section in the floating side panel. Designed to stack
 * with sibling sections so the whole panel reads as an accordion (multiple
 * panels open at once is allowed — the user's request is for "手风琴一样的折
 * 叠效果" which we interpret as "per-section collapsible", not "only one
 * open at a time").
 *
 * Header layout, when `icon` and/or `subtitle` are provided, switches from a
 * single-row 32px row to a two-line layout:
 *
 *     [chevron] [icon] Title                        [count] [actions]
 *                       subtitle (one-line muted gray)
 *
 * The subtitle stays visible in BOTH collapsed and expanded state, so the
 * user can tell what a section does without expanding it — important for the
 * commercial / "professional" panel feel.
 */
export interface AccordionSectionProps {
  /** Visible section title. */
  title: string;
  /**
   * Optional one-line muted description rendered below the title. Stays
   * visible whether or not the section is open. Use for static "what does
   * this do" text OR dynamic status strings (e.g. "11 待定 · 0 已决策").
   */
  subtitle?: ReactNode;
  /**
   * Optional 16×16 SVG icon rendered to the left of the title. Keep stroke
   * style consistent with the toolbar icons (stroke=1.4–1.5, rounded caps).
   */
  icon?: ReactNode;
  /**
   * Optional count badge shown next to the title. Renders nothing when
   * undefined; pass 0 explicitly if you want a "0" badge.
   */
  count?: number;
  /**
   * Optional small actions in the header row (right-aligned). Click events
   * should call `e.stopPropagation()` so they don't toggle the section.
   */
  actions?: ReactNode;
  /**
   * Whether this section is open by default. Subsequent open/close is owned
   * by this component (uncontrolled). Pass `open` + `onToggle` for a
   * controlled section instead.
   */
  defaultOpen?: boolean;
  /** Controlled-mode override. When provided, `defaultOpen` is ignored. */
  open?: boolean;
  /** Required iff `open` is provided. */
  onToggle?: () => void;
  /**
   * Section tone. Used by `提示` / `解析告警` to surface the right severity
   * color in the header without each section reimplementing it.
   */
  variant?: 'default' | 'info' | 'warning';
  children: ReactNode;
}

const VARIANTS: Record<
  NonNullable<AccordionSectionProps['variant']>,
  { header: string; badge: string; icon: string; subtitle: string }
> = {
  default: {
    header:
      'bg-white dark:bg-inkd-100 hover:bg-ink-50/70 dark:hover:bg-inkd-200 text-ink-700 dark:text-inkd-700',
    badge:
      'text-ink-500 dark:text-inkd-600 bg-ink-50 dark:bg-inkd-200 border border-ink-100 dark:border-inkd-300 group-hover:bg-white dark:group-hover:bg-inkd-100',
    icon: 'text-ink-400 dark:text-inkd-500',
    subtitle: 'text-ink-400 dark:text-inkd-500',
  },
  info: {
    header:
      'bg-sky-50/50 dark:bg-sky-950/30 hover:bg-sky-50 dark:hover:bg-sky-950/50 text-sky-800 dark:text-sky-300',
    badge:
      'text-sky-700 dark:text-sky-300 bg-sky-100/70 dark:bg-sky-900/40 border border-sky-200/60 dark:border-sky-700/40 group-hover:bg-sky-50 dark:group-hover:bg-sky-900/60',
    icon: 'text-sky-500 dark:text-sky-400',
    subtitle: 'text-sky-700/80 dark:text-sky-400/80',
  },
  warning: {
    header:
      'bg-rose-50/50 dark:bg-rose-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-300',
    badge:
      'text-rose-700 dark:text-rose-300 bg-rose-100/70 dark:bg-rose-900/40 border border-rose-200/60 dark:border-rose-700/40 group-hover:bg-rose-50 dark:group-hover:bg-rose-900/60',
    icon: 'text-rose-500 dark:text-rose-400',
    subtitle: 'text-rose-700/80 dark:text-rose-400/80',
  },
};

export function AccordionSection({
  title,
  subtitle,
  icon,
  count,
  actions,
  defaultOpen = true,
  open,
  onToggle,
  variant = 'default',
  children,
}: AccordionSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  // Controlled / uncontrolled both supported; the rest of the component only
  // ever reads `isOpen` so the JSX below doesn't care which mode we're in.
  const isOpen = open ?? uncontrolledOpen;
  const toggle = () => {
    if (onToggle) onToggle();
    else setUncontrolledOpen((v) => !v);
  };
  const styles = VARIANTS[variant];
  const hasSubtitle = subtitle !== undefined && subtitle !== null && subtitle !== '';

  return (
    <section className="border-b border-ink-100 dark:border-inkd-300 last:border-b-0">
      <header
        className={
          'group flex items-stretch gap-2 pl-2.5 pr-2 py-1.5 cursor-pointer select-none ' +
          'transition-colors ' +
          styles.header
        }
        onClick={toggle}
        role="button"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {/* Left rail: chevron + icon, vertically centered against the title
            block. Keeping them on the same baseline as the title (not the
            two-line column) prevents the chevron from drifting downward
            when a subtitle is present. */}
        <span className="flex items-center gap-1.5 pt-[3px] self-start shrink-0">
          <Chevron open={isOpen} />
          {icon && (
            <span className={'inline-flex items-center justify-center ' + styles.icon} aria-hidden>
              {icon}
            </span>
          )}
        </span>

        {/* Title + subtitle stacked. `min-w-0` lets the subtitle truncate
            instead of pushing the badge off-row when long. */}
        <span className="flex-1 min-w-0 flex flex-col justify-center leading-tight">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-[12.5px] truncate tracking-tight">{title}</span>
            {count !== undefined && (
              <span
                className={
                  'inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 ' +
                  'text-[10px] font-medium tabular-nums rounded-full ' +
                  styles.badge
                }
              >
                {count}
              </span>
            )}
          </span>
          {hasSubtitle && (
            <span className={'text-[10.5px] font-normal truncate mt-0.5 ' + styles.subtitle}>
              {subtitle}
            </span>
          )}
        </span>

        {actions && (
          // Actions get their own click handlers; stopping propagation is the
          // caller's responsibility (documented in props). We just give them a
          // shrink-0 slot so they don't squash the title.
          <span
            className="flex items-center gap-1 shrink-0 self-center"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </header>
      {isOpen && <div className="bg-white dark:bg-inkd-100">{children}</div>}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={
        'shrink-0 text-current opacity-60 transition-transform duration-150 ' +
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
