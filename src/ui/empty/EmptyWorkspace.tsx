import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { ARCHIVE_EXTENSION } from '../../exports/archive';
import { SAMPLE_ECOMMERCE } from '../../samples';
import { useApp } from '../../store';
import { ArchivePasswordDialog } from '../overlays/ArchivePasswordDialog';
import type { ImportMode } from '../overlays/SqlInputDialog';
import {
  inspectImportContent,
  inspectImportFiles,
  type InspectedImportFile,
} from '../import/importFiles';
import { useArchiveUnlock } from '../import/useArchiveUnlock';

interface EmptyWorkspaceProps {
  onOpenImport: (mode: ImportMode, initialFiles?: File[]) => void;
}

export function EmptyWorkspace({ onOpenImport }: EmptyWorkspaceProps) {
  const setSql = useApp((state) => state.setSql);
  const importWorkspace = useApp((state) => state.importWorkspace);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const unlock = useArchiveUnlock(true);

  const commitInspected = useCallback(
    (file: InspectedImportFile) => {
      if (file.archive) {
        if (!file.archive.ok) {
          throw new Error(`无法导入存档 ${file.fileName}：${file.archive.error}`);
        }
        importWorkspace(file.archive.state);
        return;
      }
      if (file.fileName.toLowerCase().endsWith(ARCHIVE_EXTENSION)) {
        throw new Error(`无法导入存档 ${file.fileName}：文件内容不是有效的工作区存档`);
      }
      setSql(file.content);
    },
    [importWorkspace, setSql],
  );

  const runImport = useCallback(
    async (work: () => Promise<InspectedImportFile | null>) => {
      setBusy(true);
      setError(null);
      try {
        const inspected = await work();
        if (inspected) commitInspected(inspected);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(`${message} —— 空工作区保持不变。`);
      } finally {
        setBusy(false);
      }
    },
    [commitInspected],
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (files.length > 1) {
        onOpenImport('archive', files);
        return;
      }
      await runImport(async () => {
        const result = await inspectImportFiles(files, unlock.requestUnlock);
        return result.cancelled ? null : result.files[0];
      });
    },
    [onOpenImport, runImport, unlock.requestUnlock],
  );

  const importText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      await runImport(async () => inspectImportContent(text, '拖入的文本', text.length));
    },
    [runImport],
  );

  const acceptsDrop = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('text/plain');

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) void importFiles(files);
    else void importText(event.dataTransfer.getData('text/plain'));
  };

  return (
    <section
      data-empty-workspace=""
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-ink-50/45 px-6 py-10 dark:bg-inkd-50"
      aria-label="开始使用 ER Diagram Viewer"
      aria-busy={busy}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-55 dark:opacity-25"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(203 213 225 / 0.34) 1px, transparent 1px), linear-gradient(to bottom, rgb(203 213 225 / 0.34) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative z-10 w-full max-w-[920px]">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/20">
            <DatabaseSparkIcon />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-800 dark:text-inkd-800">
            从这里开始查看数据库结构
          </h1>
          <p className="mt-2 text-[13px] text-ink-400 dark:text-inkd-500">
            先体验示例，导入自己的 DDL，或继续一个已有评审工作区
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StartCard
            title="查看示例 ER 图"
            description="第一次使用？一键加载完整示例，体验关系推断与模块分组。"
            action="加载电商示例"
            icon={<SampleIcon />}
            accent="indigo"
            disabled={busy}
            onClick={() => {
              setError(null);
              try {
                setSql(SAMPLE_ECOMMERCE);
              } catch (reason) {
                const message = reason instanceof Error ? reason.message : String(reason);
                setError(`示例加载失败：${message}`);
              }
            }}
          />
          <StartCard
            title="导入 DDL"
            description="拖入 .sql / .ddl / .txt 文件，也可以直接拖入一段 SQL 文本。"
            action="粘贴或选择文件"
            icon={<SqlFileIcon />}
            accent="sky"
            disabled={busy}
            onClick={() => onOpenImport('sql')}
          />
          <StartCard
            title="恢复工作区"
            description="拖入 .erreview，恢复批注、决策、布局与上次查看视角。"
            action="选择工作区存档"
            icon={<ArchiveIcon />}
            accent="emerald"
            disabled={busy}
            onClick={() => onOpenImport('archive')}
          />
        </div>

        {error && (
          <div
            className="mx-auto mt-4 max-w-[680px] rounded-lg border border-rose-200 bg-rose-50/95 px-3 py-2 text-center text-[12px] text-rose-700 shadow-sm dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-ink-400 dark:text-inkd-500">
          <ShieldIcon />
          所有数据仅在浏览器本地处理，不会上传服务器
        </div>
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-sky-400 bg-white/95 shadow-2xl backdrop-blur-sm dark:border-sky-500 dark:bg-inkd-100/95">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              <DropIcon />
            </div>
            <div className="text-base font-semibold text-ink-800 dark:text-inkd-800">
              释放以导入 DDL 或恢复工作区
            </div>
            <div className="text-[12px] text-ink-400 dark:text-inkd-500">
              支持 .sql / .ddl / .txt / .erreview 与纯 SQL 文本
            </div>
          </div>
        </div>
      )}

      {busy && !unlock.request && (
        <div className="absolute inset-x-0 bottom-6 z-30 flex justify-center" aria-live="polite">
          <div className="flex items-center gap-2 rounded-full border border-ink-200 bg-white/95 px-3 py-1.5 text-[11.5px] text-ink-600 shadow-lg dark:border-inkd-300 dark:bg-inkd-100/95 dark:text-inkd-700">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-200 border-t-sky-500 dark:border-inkd-300 dark:border-t-sky-400" />
            正在读取并验证…
          </div>
        </div>
      )}

      {unlock.request && (
        <ArchivePasswordDialog
          mode="decrypt"
          fileName={unlock.request.fileName}
          onClose={unlock.cancel}
          onConfirm={unlock.confirmPassword}
        />
      )}
    </section>
  );
}

export function WorkspaceRecovery({
  error,
  onOpenSql,
}: {
  error: string | null;
  onOpenSql: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-ink-50/50 px-6 dark:bg-inkd-50">
      <div className="w-full max-w-[520px] rounded-xl border border-amber-200 bg-white p-6 text-center shadow-xl dark:border-amber-800/60 dark:bg-inkd-100">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <WarningIcon />
        </div>
        <h1 className="mt-3 text-base font-semibold text-ink-800 dark:text-inkd-800">
          已保存的 SQL 需要修复
        </h1>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-500 dark:text-inkd-600">
          当前会话中的 SQL 原文仍然保留，没有加载示例，也没有覆盖任何工作区数据。
        </p>
        {error && (
          <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-left text-[11.5px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {error}
          </div>
        )}
        <button
          type="button"
          className="mt-4 rounded-md bg-ink-800 px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-ink-900 dark:bg-inkd-700 dark:text-inkd-50 dark:hover:bg-inkd-800"
          onClick={onOpenSql}
        >
          打开并修复 SQL
        </button>
      </div>
    </div>
  );
}

function StartCard({
  title,
  description,
  action,
  icon,
  accent,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  icon: ReactNode;
  accent: 'indigo' | 'sky' | 'emerald';
  disabled: boolean;
  onClick: () => void;
}) {
  const accents = {
    indigo:
      'group-hover:border-indigo-300 group-hover:shadow-indigo-500/10 dark:group-hover:border-indigo-700',
    sky: 'group-hover:border-sky-300 group-hover:shadow-sky-500/10 dark:group-hover:border-sky-700',
    emerald:
      'group-hover:border-emerald-300 group-hover:shadow-emerald-500/10 dark:group-hover:border-emerald-700',
  };
  const iconAccents = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  };

  return (
    <button
      type="button"
      aria-label={title}
      className={clsx(
        'group flex min-h-[210px] flex-col rounded-xl border border-ink-200 bg-white/95 p-5 text-left shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
        'dark:border-inkd-300 dark:bg-inkd-100/95',
        accents[accent],
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <span
        className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          iconAccents[accent],
        )}
      >
        {icon}
      </span>
      <span className="mt-4 text-[14px] font-semibold text-ink-800 dark:text-inkd-800">
        {title}
      </span>
      <span className="mt-2 flex-1 text-[11.5px] leading-relaxed text-ink-400 dark:text-inkd-500">
        {description}
      </span>
      <span className="mt-4 inline-flex items-center gap-1 text-[11.5px] font-medium text-sky-700 dark:text-sky-300">
        {action}
        <span aria-hidden>→</span>
      </span>
    </button>
  );
}

function DatabaseSparkIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="10" cy="6" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4 6v9c0 1.4 2.7 2.5 6 2.5 1 0 2-.1 2.8-.3M4 10.5c0 1.4 2.7 2.5 6 2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="m18 11 .8 2.2L21 14l-2.2.8L18 17l-.8-2.2L15 14l2.2-.8L18 11Z" fill="currentColor" />
    </svg>
  );
}

function SampleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 7h3a3 3 0 0 1 3 3v4M8 14H5v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SqlFileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path
        d="M14 3v5h4M9 12h6M9 16h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16v13H4V7ZM3 3h18v4H3V3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 11h6M12 11v5m0 0-2-2m2 2 2-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.8 13 4v3.5c0 3.2-2 5.6-5 6.7-3-1.1-5-3.5-5-6.7V4l5-2.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="m5.7 8 1.5 1.5 3.2-3.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 2.8 20h18.4L12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 9v5m0 3v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
