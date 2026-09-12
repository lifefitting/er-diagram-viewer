import { useState } from 'react';
import { useApp } from '../../store';
import { MODULE_PALETTES, type ModuleInfo } from '../../infer/inferModules';
import { PALETTE_OPTIONS } from '../../infer/paletteCatalog';
import { createModuleColor } from '../../infer/paletteColor';
import { validModuleColor } from '../../infer/moduleCustomization';

/** Draft locally; changing a native color slider must not rebuild the graph. */
export function ModuleColorEditor({
  module,
  onClose,
}: {
  module: ModuleInfo;
  onClose: () => void;
}) {
  const requested = useApp((s) => s.moduleColors[module.name]);
  const palette = useApp((s) => s.palette);
  const paletteLabel = PALETTE_OPTIONS.find((option) => option.id === palette)?.label ?? palette;
  const setModuleColor = useApp((s) => s.setModuleColor);
  const [draft, setDraft] = useState(requested ?? module.color.header);
  const color = draft.trim().toLowerCase();
  const valid = validModuleColor(color);
  const preview = valid ? createModuleColor(color, undefined, module.color.text) : module.color;
  return (
    <form
      role="dialog"
      aria-label={`修改「${module.label}」的颜色`}
      className="my-2 rounded-lg border border-ink-200 bg-white p-2.5 shadow-sm dark:border-inkd-300 dark:bg-inkd-100"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          setModuleColor(module.name, color);
          onClose();
        }
      }}
    >
      <div
        title={module.label}
        className="mb-2 truncate text-xs font-medium text-ink-800 dark:text-inkd-800"
      >
        模块颜色 · {module.label}
      </div>
      <fieldset>
        <legend className="mb-2 text-[11px] text-ink-600 dark:text-inkd-700">
          色板来源：{paletteLabel} · 当前画布配色
        </legend>
        <div className="grid grid-cols-6 gap-1.5" aria-label="预设颜色">
          {MODULE_PALETTES[palette].map((slot, index) => (
            <button
              type="button"
              key={index}
              aria-label={`使用颜色 ${slot.header}`}
              title={slot.header}
              aria-pressed={color === slot.header}
              className="h-6 rounded border border-black/10 outline-offset-2 hover:ring-2 hover:ring-blue-400"
              style={{ background: slot.header }}
              onClick={() => setDraft(slot.header)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[11px] text-ink-600 dark:text-inkd-700">自定义颜色</legend>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="自选模块颜色"
            value={valid ? color : module.color.header}
            onChange={(event) => setDraft(event.target.value)}
            className="h-8 w-9 cursor-pointer border-0 bg-transparent p-0"
          />
          <input
            aria-label="模块颜色 HEX"
            autoFocus
            spellCheck={false}
            value={draft}
            maxLength={7}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 rounded border border-ink-200 bg-transparent px-2 py-1 font-mono text-xs text-ink-800 outline-none focus:border-blue-400 dark:border-inkd-300 dark:text-inkd-800"
          />
        </div>
      </fieldset>
      <div
        className="mt-2 truncate rounded px-2 py-1.5 text-xs font-semibold"
        data-module-color-preview=""
        style={{ background: preview.header, color: preview.text }}
      >
        {module.label} · 表头预览
      </div>
      <p className="mt-1.5 text-[10px] text-ink-500 dark:text-inkd-600">
        {!valid
          ? '请输入六位 HEX 色值，例如 #087f8c。'
          : preview.header !== color
            ? `为保持统一字色清晰，表头将显示为 ${preview.header}。`
            : '表头、模块色块和连线同步更新；保留统一字色。'}
      </p>
      <div className="mt-2 flex items-center gap-1 text-[11px]">
        <button
          type="button"
          disabled={!requested}
          className="mr-auto rounded px-1.5 py-1 text-ink-500 hover:bg-ink-50 disabled:opacity-40 dark:text-inkd-600 dark:hover:bg-inkd-200"
          onClick={() => {
            setModuleColor(module.name, null);
            onClose();
          }}
        >
          恢复默认颜色
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-ink-600 hover:bg-ink-50 dark:text-inkd-700 dark:hover:bg-inkd-200"
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="rounded bg-blue-600 px-2 py-1 text-white disabled:opacity-40"
        >
          应用
        </button>
      </div>
    </form>
  );
}
