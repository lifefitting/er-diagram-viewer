import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import { ExportMenu } from './ExportMenu';
import { MODULE_PALETTES, type PaletteName, type ModuleColor } from '../../infer/inferModules';
import type { SearchScope, ThemePreference } from '../../store/types';
import {
  BrandMark,
  ClearIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SearchIcon,
  SunIcon,
  UploadIcon,
} from './icons';

interface Props {
  onOpenImport: () => void;
}

// Labels are deliberately understated two-character tone words (品牌语气：克制) —
// they describe the color temperament, not sell it.
const PALETTE_OPTIONS: Array<{ id: PaletteName; label: string; description: string }> = [
  { id: 'professional', label: '沉稳', description: '低饱和，评审默认' },
  { id: 'vibrant', label: '明快', description: '高饱和，适合演示' },
  { id: 'pastel', label: '柔和', description: '浅色调，适合久读' },
  { id: 'earth', label: '大地', description: '暖褐色调' },
  { id: 'mono', label: '单色', description: '蓝灰阶，适合打印' },
];

const THEME_OPTIONS: Array<{ id: ThemePreference; label: string; icon: () => JSX.Element }> = [
  { id: 'light', label: '亮色', icon: SunIcon },
  { id: 'dark', label: '暗色', icon: MoonIcon },
  { id: 'system', label: '跟随系统', icon: MonitorIcon },
];

export function Toolbar({ onOpenImport }: Props) {
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  const palette = useApp((s) => s.palette);
  const tableCount = useApp((s) => s.schema?.tables.length ?? 0);
  const explicitFkCount = useApp((s) => s.schema?.explicitForeignKeys.length ?? 0);
  const inferredCount = useApp((s) => s.inferred.length);
  const canvasMode = useApp((s) => s.canvasMode);
  const setCanvasMode = useApp((s) => s.setCanvasMode);
  const hasSchema = tableCount > 0;

  return (
    <header
      className={clsx(
        'h-11 flex items-center pl-3 pr-2 gap-2 border-b backdrop-blur transition-colors',
        canvasMode === 'pan'
          ? 'border-sky-200 bg-sky-50/95 dark:border-sky-800/60 dark:bg-sky-950/20'
          : 'border-amber-200 bg-amber-50/90 dark:border-amber-800/60 dark:bg-amber-950/15',
        'relative z-30',
      )}
    >
      {/*
        Two-cluster layout:
          LEFT  — identity + query     : [Brand+stats] [Search]
          RIGHT — appearance + I/O     : [Palette] [Theme] | [Import] [Export]

        Canvas view controls (relayout / fit / zoom / fullscreen) now live in
        the floating `CanvasControls` cluster bottom-right over the canvas, so
        they sit next to where the user is actually looking.
      */}

      {/* LEFT: Brand + stats, then search inline */}
      <div className="flex items-center gap-2 mr-1">
        <BrandMark />
        <div className="flex flex-col leading-tight">
          <span className="text-[12.5px] font-semibold text-ink-800 dark:text-inkd-800 tracking-tight">
            ER Diagram Viewer
          </span>
          {hasSchema && (
            <span className="text-[10px] text-ink-400 dark:text-inkd-500 tabular-nums">
              {tableCount} 表 · {explicitFkCount}+{inferredCount} FK
            </span>
          )}
        </div>
      </div>

      <Divider />

      <SearchInput value={search} onChange={setSearch} />

      <div className="flex-1" />

      <ModeSwitcher mode={canvasMode} onChange={setCanvasMode} />

      <Divider />

      {/* RIGHT: appearance tweaks (palette + theme) then I/O actions
          (import + export). Theme sits next to palette because both are
          aesthetic controls; the divider separates them from the action
          buttons so a glance distinguishes "settings" from "do it now". */}
      <PaletteDropdown current={palette} />

      <ThemeSwitcher />

      <Divider />

      <button
        type="button"
        className={clsx(
          'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium',
          'border border-ink-200 dark:border-inkd-300',
          'text-ink-800 dark:text-inkd-800',
          'bg-white dark:bg-inkd-100',
          'hover:bg-ink-50 dark:hover:bg-inkd-200',
          'active:bg-ink-100 dark:active:bg-inkd-300',
          'transition-colors',
        )}
        onClick={onOpenImport}
        title="导入 SQL DDL"
      >
        <UploadIcon />
        <span>导入</span>
      </button>

      <ExportMenu />
    </header>
  );
}

function Divider() {
  return <div className="h-5 w-px bg-ink-100 dark:bg-inkd-300" aria-hidden />;
}

/**
 * Debounced search input. The user types freely into local state, and the
 * store-level `search` (which drives the expensive canvas-wide selection
 * recompute) only updates after ~150ms of idle keypresses. We keep the local
 * input in lock-step with the store value when it changes externally (e.g.
 * the clear-search button) so the textbox doesn't fall out of sync.
 */
function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const total = useApp((s) => s.searchMatchIds.length);
  const activeIndex = useApp((s) => s.searchActiveIndex);
  const cycle = useApp((s) => s.cycleSearchMatch);
  const requestStep = useApp((s) => s.requestSearchStep);
  const scope = useApp((s) => s.searchScope);
  const setScope = useApp((s) => s.setSearchScope);

  useEffect(() => {
    setLocal(value);
  }, [value]);
  useEffect(() => {
    if (local === value) return;
    const t = window.setTimeout(() => onChange(local), 150);
    return () => window.clearTimeout(t);
  }, [local, value, onChange]);

  const hasQuery = local.trim().length > 0;

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="搜索范围"
        className="h-8 rounded-md border border-ink-200 bg-white px-1.5 text-[11px] text-ink-600 outline-none hover:border-ink-300 focus:border-ink-400 dark:border-inkd-300 dark:bg-inkd-100 dark:text-inkd-700"
        value={scope}
        onChange={(event) => setScope(event.target.value as SearchScope)}
        title="选择搜索范围"
      >
        <option value="all">全部</option>
        <option value="table">表名</option>
        <option value="field">字段</option>
      </select>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 dark:text-inkd-500 pointer-events-none">
          <SearchIcon />
        </span>
        <input
          className={clsx(
            'h-8 w-44 pl-7 pr-7 text-xs rounded-md',
            'border border-ink-200 dark:border-inkd-300',
            'bg-white dark:bg-inkd-100',
            'text-ink-800 dark:text-inkd-800',
            'focus:outline-none focus:border-ink-400 dark:focus:border-inkd-500',
            'focus:ring-1 focus:ring-ink-200 dark:focus:ring-inkd-400',
            'placeholder:text-ink-300 dark:placeholder:text-inkd-500 transition',
          )}
          placeholder={
            scope === 'table' ? '搜索表名' : scope === 'field' ? '搜索字段名' : '搜索全部'
          }
          value={local}
          title="回车跳到下一个匹配 · Shift+回车 上一个"
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const dir = e.shiftKey ? -1 : 1;
            if (local !== value) {
              // The query is still being debounced — the match list hasn't
              // recomputed yet, so stepping now would walk the OLD list. Flush
              // the query and defer the step until the fresh matches land.
              onChange(local);
              requestStep(dir);
            } else {
              cycle(dir);
            }
          }}
        />
        {local && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-300 dark:text-inkd-500 hover:text-ink-600 dark:hover:text-inkd-700"
            onClick={() => {
              setLocal('');
              onChange('');
            }}
            aria-label="清除搜索"
          >
            <ClearIcon />
          </button>
        )}
      </div>
      {/* Find-style match counter + step controls. The canvas centers on the
          active match and rings it; Enter / these buttons cycle through them. */}
      {hasQuery && (
        <div className="flex items-center gap-0.5 shrink-0">
          <span
            className={clsx(
              'text-[10.5px] tabular-nums min-w-[2.4rem] text-center',
              total > 0 ? 'text-ink-500 dark:text-inkd-600' : 'text-ink-300 dark:text-inkd-500',
            )}
            aria-live="polite"
            title="当前匹配 / 匹配总数"
          >
            {total > 0 ? `${Math.max(activeIndex + 1, 0)}/${total}` : '0/0'}
          </span>
          <MatchNavButton
            label="上一个匹配 (Shift+回车)"
            glyph="▲"
            disabled={total === 0}
            onClick={() => cycle(-1)}
          />
          <MatchNavButton
            label="下一个匹配 (回车)"
            glyph="▼"
            disabled={total === 0}
            onClick={() => cycle(1)}
          />
        </div>
      )}
    </div>
  );
}

function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: 'select' | 'pan';
  onChange: (mode: 'select' | 'pan') => void;
}) {
  return (
    <div
      className="flex h-8 items-center rounded-md border border-ink-200 bg-white/80 p-0.5 shadow-sm dark:border-inkd-300 dark:bg-inkd-100/80"
      role="group"
      aria-label="工作模式"
    >
      <button
        type="button"
        className={clsx(
          'h-6 rounded px-2 text-[11px] font-semibold transition-colors',
          mode === 'pan'
            ? 'bg-sky-600 text-white shadow-sm dark:bg-sky-500 dark:text-sky-950'
            : 'text-ink-400 hover:text-ink-700 dark:text-inkd-500 dark:hover:text-inkd-800',
        )}
        onClick={() => onChange('pan')}
        aria-pressed={mode === 'pan'}
        title="阅读模式：锁定布局，拖拽平移画布"
      >
        ◉ 阅读
      </button>
      <button
        type="button"
        className={clsx(
          'h-6 rounded px-2 text-[11px] font-semibold transition-colors',
          mode === 'select'
            ? 'bg-amber-500 text-amber-950 shadow-sm dark:bg-amber-400'
            : 'text-ink-400 hover:text-ink-700 dark:text-inkd-500 dark:hover:text-inkd-800',
        )}
        onClick={() => onChange('select')}
        aria-pressed={mode === 'select'}
        title="编辑模式：框选、移动、连线和评审批注"
      >
        ✦ 编辑
      </button>
    </div>
  );
}

function MatchNavButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        'h-6 w-5 flex items-center justify-center rounded text-[9px] leading-none',
        'text-ink-400 dark:text-inkd-500',
        'hover:bg-ink-50 hover:text-ink-700 dark:hover:bg-inkd-200 dark:hover:text-inkd-800',
        'disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-400',
        'transition-colors',
      )}
    >
      {glyph}
    </button>
  );
}

function PaletteDropdown({ current }: { current: PaletteName }) {
  const setPalette = useApp((s) => s.setPalette);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const currentOpt = PALETTE_OPTIONS.find((o) => o.id === current) ?? PALETTE_OPTIONS[0];

  return (
    <div ref={wrapRef} className="relative">
      {/* Icon-only trigger (matches ThemeSwitcher): the palette glyph says
          "colors live here" without pinning a strip of swatches to the toolbar;
          the per-palette previews stay inside the dropdown options. */}
      <button
        type="button"
        className={clsx(
          'inline-flex items-center justify-center h-8 w-8 rounded-md',
          'text-ink-600 dark:text-inkd-600',
          'hover:bg-ink-50 dark:hover:bg-inkd-200',
          'hover:text-ink-800 dark:hover:text-inkd-800',
          'transition-colors',
        )}
        onClick={() => setOpen((v) => !v)}
        title={`模块色系: ${currentOpt.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换模块色系"
      >
        <PaletteIcon />
      </button>
      {open && (
        <div
          className={clsx(
            'absolute left-0 top-full mt-1 min-w-[220px]',
            'bg-white dark:bg-inkd-100',
            'border border-ink-100 dark:border-inkd-300',
            'rounded-md shadow-xl z-40 py-1',
          )}
          role="listbox"
        >
          {PALETTE_OPTIONS.map((opt) => {
            const active = opt.id === current;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={active}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                  'hover:bg-ink-50 dark:hover:bg-inkd-200',
                  active && 'bg-ink-50 dark:bg-inkd-200',
                )}
                onClick={() => {
                  setPalette(opt.id);
                  setOpen(false);
                }}
              >
                <ColorStrip colors={MODULE_PALETTES[opt.id].slice(0, 5)} />
                <span className="flex-1">
                  <span className="text-ink-800 dark:text-inkd-800 font-medium">{opt.label}</span>
                  <span className="text-ink-400 dark:text-inkd-500 ml-1">{opt.description}</span>
                </span>
                {active && <span className="text-emerald-500 text-[12px] leading-none">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ColorStrip({ colors }: { colors: ModuleColor[] }) {
  return (
    <span className="flex shrink-0 rounded overflow-hidden border border-ink-100/70 dark:border-inkd-300/70">
      {colors.map((c, i) => (
        <span key={i} className="w-2.5 h-3 inline-block" style={{ background: c.header }} />
      ))}
    </span>
  );
}

/**
 * Light / dark / system theme dropdown. The icon button shows the icon for
 * whichever preference is currently active, so users with `system` selected
 * still get a monitor glyph (rather than the resolved sun/moon — that would
 * make `system` indistinguishable from `light`/`dark` at a glance).
 */
function ThemeSwitcher() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = THEME_OPTIONS.find((o) => o.id === theme) ?? THEME_OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={clsx(
          'inline-flex items-center justify-center h-8 w-8 rounded-md',
          'text-ink-600 dark:text-inkd-600',
          'hover:bg-ink-50 dark:hover:bg-inkd-200',
          'hover:text-ink-800 dark:hover:text-inkd-800',
          'transition-colors',
        )}
        onClick={() => setOpen((v) => !v)}
        title={`主题: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换主题"
      >
        <CurrentIcon />
      </button>
      {open && (
        <div
          className={clsx(
            'absolute right-0 top-full mt-1 min-w-[140px]',
            'bg-white dark:bg-inkd-100',
            'border border-ink-100 dark:border-inkd-300',
            'rounded-md shadow-xl z-40 py-1',
          )}
          role="listbox"
        >
          {THEME_OPTIONS.map((opt) => {
            const active = opt.id === theme;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={active}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                  'hover:bg-ink-50 dark:hover:bg-inkd-200',
                  active && 'bg-ink-50 dark:bg-inkd-200',
                )}
                onClick={() => {
                  setTheme(opt.id);
                  setOpen(false);
                }}
              >
                <span className="text-ink-600 dark:text-inkd-700">
                  <Icon />
                </span>
                <span className="flex-1 text-ink-800 dark:text-inkd-800 font-medium">
                  {opt.label}
                </span>
                {active && <span className="text-emerald-500 text-[12px] leading-none">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
