import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, effectiveForeignKeys, visibleSchema, getPersistedSnapshot } from '../../store';
import { buildWorkspaceArchive, ARCHIVE_EXTENSION } from '../../exports/archive';
import { version as appVersion } from '../../../package.json';
import type { Core } from 'cytoscape';
import { getCy } from '../../diagram/cyHandle';
import { appendInferredToScript } from '../../exports/toDdl';
import { buildReviewReport } from '../../exports/toReport';
import { buildSpecDoc } from '../../exports/toSpecDoc';
import { fkKey } from '../../infer/inferForeignKeys';
import { nodeId } from '../../diagram/nodeId';
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
  // 评审报告 options sub-panel: whether to include the engine's candidate
  // lists (a reviewer may want a "facts + opinions only" report).
  const [reportOptsOpen, setReportOptsOpen] = useState(false);
  const [incFkCandidates, setIncFkCandidates] = useState(true);
  const [incLogicalCandidates, setIncLogicalCandidates] = useState(true);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rawSchema = useApp((s) => s.schema);
  const modules = useApp((s) => s.modules);
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const manualFks = useApp((s) => s.manualFks);
  const fieldNotes = useApp((s) => s.fieldNotes);
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
  // Exports follow the on-canvas visibility, including the 逻辑关联/手动连线
  // section toggles — what you see is what you export.
  const effectiveFks = useMemo(
    () =>
      schema
        ? effectiveForeignKeys(
            schema,
            inferred,
            decisions,
            showLow,
            deletedTables,
            manualFks,
            display,
          )
        : [],
    [schema, inferred, decisions, showLow, deletedTables, manualFks, display],
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
    // Everything not already in the script: inferred (visible/accepted) FKs
    // plus user-added manual ones. Logical links come out as comment lines
    // (toDdl splits by kind) — no physical constraint exists to declare.
    const added = effectiveFks.filter((f) => f.source !== 'explicit');
    const ddl = appendInferredToScript(rawSql, added);
    download(
      'data:text/plain;charset=utf-8,' + encodeURIComponent(ddl),
      `schema-with-fks-${ts()}.sql`,
    );
    setOpen(false);
  };

  const exportReport = () => {
    if (!schema || !rawSchema) return;
    // Recycle-bin'd tables by ORIGINAL name: deletedTables keys are node ids
    // (`t:` + lowercased name), so reverse-map through the raw schema.
    const deletedTableNames = rawSchema.tables
      .map((t) => t.name)
      .filter((name) => deletedTables[nodeId(name)]);
    const md = buildReviewReport({
      schema,
      inferred,
      decisions,
      manualFks,
      deletedTableNames,
      fieldNotes,
      include: {
        inferredFkCandidates: incFkCandidates,
        logicalCandidates: incLogicalCandidates,
      },
    });
    download(
      'data:text/markdown;charset=utf-8,' + encodeURIComponent(md),
      `er-review-report-${ts()}.md`,
    );
    setOpen(false);
    setReportOptsOpen(false);
  };

  const exportSpecDoc = () => {
    if (!schema) return;
    // A spec document states FACTS: explicit FKs, user-accepted candidates and
    // manual relations — never pending candidates (those live in the 评审报告).
    const confirmed = effectiveFks.filter(
      (f) => f.source !== 'inferred' || decisions[fkKey(f)] === 'accept',
    );
    const md = buildSpecDoc({ schema, relations: confirmed });
    download('data:text/markdown;charset=utf-8,' + encodeURIComponent(md), `db-spec-${ts()}.md`);
    setOpen(false);
  };

  const exportArchive = () => {
    if (!rawSchema) return;
    // The archive is a WORKSPACE snapshot, not a view export: it includes the
    // full persisted state (recycle-binned tables, rejected candidates, layout,
    // camera), so opening it elsewhere reproduces this session exactly.
    const json = buildWorkspaceArchive(
      getPersistedSnapshot() as unknown as Record<string, unknown>,
      {
        appVersion,
        exportedAt: new Date().toISOString(),
        tableCount: rawSchema.tables.length,
      },
    );
    download(
      'data:application/json;charset=utf-8,' + encodeURIComponent(json),
      `er-workspace-${ts()}${ARCHIVE_EXTENSION}`,
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
          // Dark mode is a LIGHT button (inkd-700/800 are light steps), so the
          // text must stay dark in every state — hover:text-white was a bug.
          'dark:bg-inkd-700 dark:text-inkd-50 dark:hover:bg-inkd-800 ' +
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
          <MenuItem
            icon={<ReportIcon />}
            label="评审报告"
            hint={reportOptsOpen ? '选项 ▴' : '.md ▾'}
            onClick={() => setReportOptsOpen((v) => !v)}
          />
          {reportOptsOpen && (
            <div className="mx-2 mb-1 rounded-md border border-ink-100 bg-ink-50/50 px-2 py-1.5 text-[11px] dark:border-inkd-300 dark:bg-inkd-200/50">
              <label className="flex cursor-pointer items-center gap-1.5 py-0.5 text-ink-600 dark:text-inkd-700">
                <input
                  type="checkbox"
                  className="accent-ink-700 dark:accent-inkd-700"
                  checked={incFkCandidates}
                  onChange={() => setIncFkCandidates((v) => !v)}
                />
                包含推断外键候选
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 py-0.5 text-ink-600 dark:text-inkd-700">
                <input
                  type="checkbox"
                  className="accent-ink-700 dark:accent-inkd-700"
                  checked={incLogicalCandidates}
                  onChange={() => setIncLogicalCandidates((v) => !v)}
                />
                包含逻辑关联候选（手动连线始终包含）
              </label>
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  className="h-6 rounded bg-ink-800 px-2.5 text-[11px] font-medium text-white hover:bg-ink-900 dark:bg-inkd-700 dark:text-inkd-50 dark:hover:bg-inkd-800"
                  onClick={exportReport}
                >
                  导出报告
                </button>
              </div>
            </div>
          )}
          <MenuItem icon={<SpecIcon />} label="数据库说明文档" hint=".md" onClick={exportSpecDoc} />
          <div className="my-1 border-t border-ink-100 dark:border-inkd-300" />
          <MenuItem
            icon={<ArchiveIcon />}
            label="工作区存档"
            hint=".erreview"
            onClick={exportArchive}
          />
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

function ReportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpecIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6h11M6.5 6v7M2.5 9.5h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M3.2 6.5v5A1.5 1.5 0 0 0 4.7 13h6.6a1.5 1.5 0 0 0 1.5-1.5v-5M6.5 9h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
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
