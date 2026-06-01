import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, effectiveForeignKeys, visibleSchema } from '../../store';
import type { Core } from 'cytoscape';
import { getCy } from '../../diagram/cyHandle';
import { appendInferredToScript } from '../../exports/toDdl';
import {
  buildDiagramSvg,
  exportBackgroundColor,
  svgToPngDataUrl,
  type ExportTheme,
} from '../../exports/toSvg';
import { buildFkSourceColumns } from '../../diagram/buildGraph';
import type { ThemePreference } from '../../store/types';

/** Resolve the user's theme preference into a concrete light/dark value.
 *  Mirrors `useApplyTheme`'s resolver so exports follow whatever the user
 *  currently sees on screen, including the `system` → matchMedia case. */
function resolveExportTheme(pref: ThemePreference): ExportTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'png' | 'svg'>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rawSchema = useApp((s) => s.schema);
  const modules = useApp((s) => s.modules);
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const deletedTables = useApp((s) => s.deletedTables);
  const rawSql = useApp((s) => s.rawSql);
  const display = useApp((s) => s.display);
  const themePref = useApp((s) => s.theme);
  const showLow = display.showLowConfidence;

  // Exports follow what's on the canvas — recycle-bin'd tables (and their FKs)
  // are filtered out.
  const schema = useMemo(() => visibleSchema(rawSchema, deletedTables), [rawSchema, deletedTables]);

  // The same effective FK set the canvas draws, so the exported file matches
  // the on-screen state including pending/accepted/rejected decisions + hidden tables.
  const effectiveFks = useMemo(
    () => (schema ? effectiveForeignKeys(schema, inferred, decisions, showLow, deletedTables) : []),
    [schema, inferred, decisions, showLow, deletedTables],
  );

  const fkSourceColumns = useMemo(() => buildFkSourceColumns(effectiveFks), [effectiveFks]);

  // Close menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const buildSvg = (theme: ExportTheme): string | null => {
    const cy = getCy<Core>();
    if (!cy || !schema) return null;
    return buildDiagramSvg(cy, {
      schema,
      modules,
      fkSourceColumns,
      display,
      theme,
    });
  };

  const exportSvg = async () => {
    setBusy('svg');
    try {
      const theme = resolveExportTheme(themePref);
      const svg = buildSvg(theme);
      if (!svg) return;
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      download(url, `er-diagram-${ts()}.svg`);
      // Slight delay before revoke so the browser can pick up the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const exportPng = async () => {
    setBusy('png');
    try {
      const theme = resolveExportTheme(themePref);
      const svg = buildSvg(theme);
      if (!svg) return;
      // Rasterize the same SVG at 2x for a high-resolution PNG. This guarantees
      // PNG and SVG show identical content (including the React-rendered cards
      // that cy.png() would otherwise miss).
      const pngUrl = await svgToPngDataUrl(svg, 2, exportBackgroundColor(theme));
      download(pngUrl, `er-diagram-${ts()}.png`);
    } catch (err) {
      console.error('[exportPng] failed:', err);
      // eslint-disable-next-line no-alert
      window.alert('导出 PNG 失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const exportDdl = () => {
    if (!schema) return;
    const fks = effectiveFks;
    const onlyInferred = fks.filter((f) => f.source === 'inferred');
    const ddl = appendInferredToScript(rawSql, onlyInferred);
    download(
      'data:text/plain;charset=utf-8,' + encodeURIComponent(ddl),
      `schema-with-fks-${ts()}.sql`,
    );
    setOpen(false);
  };

  const disabled = !schema;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={
          'inline-flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-md text-xs font-medium ' +
          'bg-ink-800 text-white hover:bg-ink-900 ' +
          'dark:bg-inkd-700 dark:text-inkd-50 dark:hover:bg-inkd-800 dark:hover:text-white ' +
          'disabled:bg-ink-100 disabled:text-ink-400 dark:disabled:bg-inkd-200 dark:disabled:text-inkd-500 ' +
          'disabled:cursor-not-allowed transition-colors'
        }
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DownloadIcon />
        <span>导出</span>
        <span className="text-[10px] opacity-80">▾</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 min-w-[200px] bg-white dark:bg-inkd-100 border border-ink-100 dark:border-inkd-300 rounded-md shadow-xl text-sm z-40 py-1"
          role="menu"
        >
          <MenuItem
            icon={<ImageIcon />}
            label="PNG 图像"
            hint="2× 分辨率"
            disabled={busy !== null}
            running={busy === 'png'}
            onClick={exportPng}
          />
          <MenuItem
            icon={<SvgIcon />}
            label="SVG 矢量图"
            hint="ER 图，可编辑"
            disabled={busy !== null}
            running={busy === 'svg'}
            onClick={exportSvg}
          />
          <div className="my-1 border-t border-ink-100 dark:border-inkd-300" />
          <MenuItem icon={<CodeIcon />} label="含 FK 的 DDL" hint=".sql" onClick={exportDdl} />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  disabled,
  running,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  running?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={
        'flex items-center w-full text-left px-2.5 py-1.5 gap-2 text-xs ' +
        'hover:bg-ink-50 dark:hover:bg-inkd-200 ' +
        'disabled:text-ink-300 dark:disabled:text-inkd-500 disabled:hover:bg-transparent'
      }
    >
      <span className="text-ink-500 dark:text-inkd-600">{icon}</span>
      <span className="text-ink-800 dark:text-inkd-800 flex-1">{label}</span>
      {running ? (
        <span className="text-ink-400 dark:text-inkd-500 text-[10px]">导出中…</span>
      ) : hint ? (
        <span className="text-ink-400 dark:text-inkd-500 text-[10px]">{hint}</span>
      ) : null}
    </button>
  );
}

function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="7" r="1.1" fill="currentColor" />
      <path
        d="M3 12l3-3 3 3 2-2 3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SvgIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fontSize="5.5"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
        fill="currentColor"
      >
        SVG
      </text>
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 4L2 8l4 4M10 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
