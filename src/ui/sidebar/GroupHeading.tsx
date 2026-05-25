/**
 * Tiny section-group label. Used to chunk the accordion into two clusters
 * ("显示设置" vs "智能分析") so the panel reads as a real settings surface
 * instead of a flat list of unrelated boxes.
 */
export function GroupHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 px-3 pt-2.5 pb-1 select-none">
      <span className="text-[10.5px] font-semibold tracking-wider text-ink-500 dark:text-inkd-600 uppercase">
        {label}
      </span>
      {hint && (
        <span className="text-[9.5px] text-ink-300 dark:text-inkd-500 font-medium tracking-wide uppercase">
          {hint}
        </span>
      )}
    </div>
  );
}
