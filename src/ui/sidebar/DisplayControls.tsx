import { useApp } from '../../store';

const ITEMS = [
  { key: 'onlyPk', label: '仅显示主键' },
  { key: 'showType', label: '显示类型' },
  { key: 'showComment', label: '显示注释' },
  { key: 'showIndex', label: '显示索引徽标' },
] as const;

/**
 * Content-only rendering: header lives in the surrounding AccordionSection.
 * This component only owns the checkbox grid.
 */
export function DisplayControls() {
  const display = useApp((s) => s.display);
  const toggle = useApp((s) => s.toggleDisplay);
  return (
    <div className="px-3 py-2 grid grid-cols-2 gap-y-1.5 gap-x-2">
      {ITEMS.map((item) => (
        <label
          key={item.key}
          className="flex items-center gap-1.5 cursor-pointer text-[12px] text-ink-700 dark:text-inkd-700 hover:text-ink-900 dark:hover:text-inkd-900"
        >
          <input
            type="checkbox"
            className="accent-ink-800 dark:accent-inkd-700"
            checked={display[item.key as keyof typeof display]}
            onChange={() => toggle(item.key as Parameters<typeof toggle>[0])}
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}
