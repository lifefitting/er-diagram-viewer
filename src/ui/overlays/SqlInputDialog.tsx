import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import { parseSql } from '../../parser';
import { SAMPLE_ECOMMERCE, SAMPLE_BLOG } from '../../samples';
import {
  looksLikeArchive,
  parseWorkspaceArchive,
  isEncryptedWorkspaceArchive,
  decryptWorkspaceArchive,
  ARCHIVE_EXTENSION,
  type ParseArchiveResult,
} from '../../exports/archive';
import { mergeWorkspaceArchives, type MergeArchivesResult } from '../../exports/mergeArchives';
import { ArchivePasswordDialog } from './ArchivePasswordDialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface LoadedFile {
  name: string;
  size: number;
}

/** A successfully parsed `.erreview` file staged for import. */
type LoadedArchive = Extract<ParseArchiveResult, { ok: true }>;

/** The archive tab's staged file: the parsed payload plus where it came from. */
interface StagedArchive {
  archive: LoadedArchive;
  fileName: string;
  size: number;
  encrypted: boolean;
}

/** The dialog's two explicit entry modes（导入什么）. */
type ImportMode = 'sql' | 'archive';

const MODE_TABS: Array<{ id: ImportMode; label: string; hint: string }> = [
  { id: 'sql', label: 'SQL 脚本', hint: '粘贴 DDL · 上传 .sql 文件 · 或将文件拖拽到任意位置' },
  {
    id: 'archive',
    label: '工作区存档',
    hint: '导入 .erreview 存档，恢复完整评审现场（含批注 / 决策 / 布局 / 视角）',
  },
];

const SAMPLES: Array<{ id: string; label: string; description: string; sql: string }> = [
  {
    id: 'ecommerce',
    label: '电商样例',
    description: '无显式 FK，展示 FK 推断',
    sql: SAMPLE_ECOMMERCE,
  },
  {
    id: 'blog',
    label: '博客样例',
    description: '含显式 FK 与索引',
    sql: SAMPLE_BLOG,
  },
];

const PLACEHOLDER =
  '-- 在此粘贴 CREATE TABLE / ALTER TABLE 脚本\n' +
  '-- 或将 .sql 文件拖拽到此处\n' +
  '\n' +
  'CREATE TABLE users (\n' +
  '  id BIGINT PRIMARY KEY AUTO_INCREMENT,\n' +
  "  email VARCHAR(255) NOT NULL COMMENT '用户邮箱',\n" +
  '  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n' +
  ');';

export function SqlInputDialog({ open, onClose }: Props) {
  const setSql = useApp((s) => s.setSql);
  const importWorkspace = useApp((s) => s.importWorkspace);
  const currentSql = useApp((s) => s.rawSql);
  const [text, setText] = useState(currentSql);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  // Which entry the user is on. The two modes hold independent state: `text`
  // belongs to the SQL tab, `staged` to the archive tab — switching tabs
  // never clobbers the other side's work-in-progress.
  const [mode, setMode] = useState<ImportMode>('sql');
  // The archive tab accepts one archive (restore) or several (merge). Keeping
  // all parsed payloads staged lets us pre-flight the complete merge before a
  // single atomic store update touches the current workspace.
  const [staged, setStaged] = useState<StagedArchive[]>([]);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlockRequest, setUnlockRequest] = useState<{
    content: string;
    fileName: string;
  } | null>(null);
  const unlockResolverRef = useRef<((text: string | null) => void) | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const samplesMenuRef = useRef<HTMLDivElement | null>(null);

  const requestArchiveUnlock = useCallback((content: string, fileName: string) => {
    return new Promise<string | null>((resolve) => {
      unlockResolverRef.current?.(null);
      unlockResolverRef.current = resolve;
      setUnlockRequest({ content, fileName });
    });
  }, []);

  const closeUnlockDialog = useCallback(() => {
    unlockResolverRef.current?.(null);
    unlockResolverRef.current = null;
    setUnlockRequest(null);
  }, []);

  // A parent-level close/unmount can happen independently of the nested
  // password dialog. Always settle its pending file-read promise so a later
  // import never resumes against stale component state.
  useEffect(() => {
    if (!open) closeUnlockDialog();
    return () => {
      unlockResolverRef.current?.(null);
      unlockResolverRef.current = null;
    };
  }, [open, closeUnlockDialog]);

  // Resync the editor with persisted SQL each time the dialog opens — the user
  // may have run a different setSql in between, and we don't want to discard
  // their current schema if they cancel out.
  useEffect(() => {
    if (open) {
      setText(currentSql);
      setLoadedFile(null);
      setStaged([]);
      setMode('sql');
      setSamplesOpen(false);
      setError(null);
    }
  }, [open, currentSql]);

  // Auto-focus the textarea on open. Users who hit ⌘I or click 导入 want to
  // start typing/pasting immediately, not chase the cursor with a click.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const mergePreview = useMemo<MergeArchivesResult | null>(
    () =>
      staged.length > 1
        ? mergeWorkspaceArchives(staged.map(({ archive, fileName }) => ({ archive, fileName })))
        : null,
    [staged],
  );

  const submit = useCallback(() => {
    const archive = mode === 'archive' && staged.length === 1 ? staged[0].archive : null;
    const merged = mode === 'archive' && staged.length > 1 ? mergePreview : null;
    if (mode === 'archive' && !archive && !merged) return;
    if (merged && !merged.ok) {
      setError(
        `${merged.error}${merged.conflicts.length ? `：${merged.conflicts.join('、')}` : ''}`,
      );
      return;
    }
    if (mode === 'sql' && !text.trim()) return;
    // Pre-flight parse before committing: `setSql` / `importWorkspace`
    // unconditionally replace decisions, layout and the recycle bin, so
    // garbage input (or a parser throw) must not be allowed to wipe the
    // current workspace.
    try {
      const sql = archive ? archive.state.rawSql : merged?.ok ? merged.state.rawSql : text;
      const parsed = parseSql(sql);
      if (parsed.tables.length === 0) {
        setError(
          '未解析出任何表：请确认粘贴的是 CREATE TABLE / ALTER TABLE 脚本。当前图保持不变。',
        );
        return;
      }
      if (merged?.ok) importWorkspace(merged.state);
      else if (archive) importWorkspace(archive.state);
      else setSql(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`解析失败：${msg} —— 当前图保持不变。`);
      return;
    }
    onClose();
  }, [setSql, importWorkspace, mergePreview, mode, staged, text, onClose]);

  // Keyboard shortcuts: Esc closes (or first closes the samples dropdown if
  // open), ⌘/Ctrl+Enter submits. Bound at window level so the textarea,
  // buttons, or focus-less states all work.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (unlockRequest) return; // the password dialog owns Escape / Enter
      if (e.key === 'Escape') {
        e.preventDefault();
        if (samplesOpen) setSamplesOpen(false);
        else onClose();
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submit, samplesOpen, unlockRequest]);

  // Close samples dropdown on outside click.
  useEffect(() => {
    if (!samplesOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!samplesMenuRef.current?.contains(e.target as Node)) setSamplesOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [samplesOpen]);

  // One file handler for both tabs: content decides the destination（按内容
  // 路由）— an archive lands on the 工作区存档 tab, SQL lands on the SQL tab,
  // switching the dialog there so the user always sees where their file went.
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const archives: StagedArchive[] = [];
      let sqlFile: { content: string; file: File } | null = null;

      for (const file of files) {
        const originalContent = await file.text();
        const encrypted = isEncryptedWorkspaceArchive(originalContent);
        const content = encrypted
          ? await requestArchiveUnlock(originalContent, file.name)
          : originalContent;
        if (content === null) return;
        if (looksLikeArchive(content)) {
          const parsed = parseWorkspaceArchive(content);
          if (parsed.ok) {
            archives.push({ archive: parsed, fileName: file.name, size: file.size, encrypted });
            continue;
          }
          if (file.name.endsWith(ARCHIVE_EXTENSION) || files.length > 1 || mode === 'archive') {
            setMode('archive');
            setError(`无法导入存档 ${file.name}：${parsed.error}`);
            return;
          }
        }
        if (files.length > 1 || mode === 'archive') {
          setMode('archive');
          setError(`合并时只能选择有效的 ${ARCHIVE_EXTENSION} 工作区存档`);
          return;
        }
        sqlFile = { content, file };
      }

      if (archives.length > 0) {
        setStaged((current) => {
          const next = [...current];
          for (const item of archives) {
            const existing = next.findIndex((candidate) => candidate.fileName === item.fileName);
            if (existing >= 0) next[existing] = item;
            else next.push(item);
          }
          return next;
        });
        setMode('archive');
        setError(null);
        return;
      }

      if (sqlFile) {
        setText(sqlFile.content);
        setLoadedFile({ name: sqlFile.file.name, size: sqlFile.file.size });
        setMode('sql');
        setError(null);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [mode, requestArchiveUnlock],
  );

  const onPickFile = useCallback(() => fileInputRef.current?.click(), []);

  // Drag-and-drop: accept any file dropped onto the dialog body. We don't
  // strictly enforce `.sql` extension — users often have `.txt` / `.ddl`
  // exports — read as text and let the parser warnings flag non-DDL content.
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only flip off when leaving the dialog body, not a child element.
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void handleFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [handleFiles],
  );

  const stats = useMemo(() => {
    if (!text) return { lines: 0, chars: 0 };
    return { lines: text.split('\n').length, chars: text.length };
  }, [text]);

  const submittable =
    mode === 'archive'
      ? staged.length > 0 && (staged.length === 1 || mergePreview?.ok === true)
      : text.trim().length > 0;
  const modeTab = MODE_TABS.find((t) => t.id === mode)!;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/50 dark:bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sql-dialog-title"
    >
      <div
        className={clsx(
          'w-[min(960px,94vw)] max-h-[88vh] flex flex-col',
          'rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10',
          'bg-white dark:bg-inkd-100',
        )}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Header: title + the two explicit entry tabs. What gets imported is
            a MODE the user picks (or the dropped file picks for them), not a
            guess buried inside one shared flow. */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100 dark:border-inkd-300">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-md bg-ink-800 dark:bg-inkd-700 text-white dark:text-inkd-50 flex items-center justify-center">
              <DatabaseIcon />
            </div>
            <div className="min-w-0">
              <h2
                id="sql-dialog-title"
                className="text-sm font-semibold text-ink-800 dark:text-inkd-800 leading-tight"
              >
                导入
              </h2>
              <div className="text-[11px] text-ink-400 dark:text-inkd-500 leading-tight mt-0.5 truncate">
                {modeTab.hint}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex rounded-md bg-ink-100/70 p-0.5 dark:bg-inkd-200/70"
              role="tablist"
              aria-label="导入类型"
            >
              {MODE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.id}
                  className={clsx(
                    'h-7 rounded px-3 text-[12px] font-medium transition-colors',
                    mode === tab.id
                      ? 'bg-white text-ink-800 shadow-sm dark:bg-inkd-100 dark:text-inkd-800'
                      : 'text-ink-500 hover:text-ink-700 dark:text-inkd-600 dark:hover:text-inkd-800',
                  )}
                  onClick={() => {
                    setMode(tab.id);
                    setError(null);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="w-8 h-8 rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-50 dark:text-inkd-500 dark:hover:text-inkd-800 dark:hover:bg-inkd-200 flex items-center justify-center transition-colors"
              onClick={onClose}
              aria-label="关闭对话框"
              title="关闭 (Esc)"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Shared hidden file input — the SQL toolbar's 上传文件 and the
            archive tab's 选择存档文件 both funnel through handleFile, which
            routes by content. */}
        <input
          type="file"
          accept=".sql,.ddl,.txt,.erreview,.json,text/plain,application/json"
          multiple={mode === 'archive'}
          hidden
          ref={fileInputRef}
          onChange={async (e) => {
            await handleFiles(Array.from(e.target.files ?? []));
            // Reset so picking the same file again still fires change.
            e.target.value = '';
          }}
        />

        {/* Toolbar (SQL 脚本 tab only) */}
        {mode === 'sql' && (
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-ink-100 dark:border-inkd-300 bg-ink-50/60 dark:bg-inkd-50/60">
            <SecondaryButton onClick={onPickFile} icon={<UploadIcon />}>
              上传文件
            </SecondaryButton>

            <div className="relative" ref={samplesMenuRef}>
              <SecondaryButton
                onClick={() => setSamplesOpen((v) => !v)}
                icon={<SparklesIcon />}
                chevron
                active={samplesOpen}
              >
                加载样例
              </SecondaryButton>
              {samplesOpen && (
                <div className="absolute left-0 top-full mt-1 w-64 rounded-md bg-white dark:bg-inkd-100 shadow-lg ring-1 ring-black/5 dark:ring-white/10 py-1 z-10">
                  {SAMPLES.map((sample) => (
                    <button
                      key={sample.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-ink-50 dark:hover:bg-inkd-200 transition-colors"
                      onClick={() => {
                        setText(sample.sql);
                        setLoadedFile(null);
                        setSamplesOpen(false);
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                    >
                      <div className="text-sm font-medium text-ink-800 dark:text-inkd-800">
                        {sample.label}
                      </div>
                      <div className="text-[11px] text-ink-400 dark:text-inkd-500">
                        {sample.description}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {text.length > 0 && (
              <SecondaryButton
                onClick={() => {
                  setText('');
                  setLoadedFile(null);
                  textareaRef.current?.focus();
                }}
                icon={<TrashIcon />}
                variant="ghost"
              >
                清空
              </SecondaryButton>
            )}

            <div className="flex-1" />

            {loadedFile && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[11px]">
                <FileIcon />
                <span className="font-mono">{loadedFile.name}</span>
                <span className="opacity-60">· {formatBytes(loadedFile.size)}</span>
              </div>
            )}
          </div>
        )}

        {/* Body: SQL editor OR archive panel, by mode */}
        <div className="relative flex-1 min-h-[280px]">
          {mode === 'sql' ? (
            <textarea
              ref={textareaRef}
              className={clsx(
                'absolute inset-0 w-full h-full px-5 py-4 font-mono text-[13px] leading-[1.55] resize-none',
                'bg-transparent text-ink-800 dark:text-inkd-800',
                'placeholder:text-ink-300 dark:placeholder:text-inkd-500',
                'focus:outline-none',
              )}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Manual edits invalidate the "loaded from file" badge and any
                // stale parse-failure message.
                if (loadedFile) setLoadedFile(null);
                if (error) setError(null);
              }}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          ) : (
            <ArchivePanel
              staged={staged}
              mergePreview={mergePreview}
              onPickFile={onPickFile}
              onRemove={(fileName) =>
                setStaged((current) => current.filter((item) => item.fileName !== fileName))
              }
            />
          )}
          {dragOver && (
            <div className="absolute inset-3 rounded-lg border-2 border-dashed border-ink-400 dark:border-inkd-500 bg-white/95 dark:bg-inkd-50/95 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <div className="w-12 h-12 rounded-full bg-ink-100 dark:bg-inkd-200 flex items-center justify-center text-ink-700 dark:text-inkd-800">
                <DropIcon />
              </div>
              <div className="text-sm font-medium text-ink-800 dark:text-inkd-800">
                释放以加载文件
              </div>
              <div className="text-[11px] text-ink-400 dark:text-inkd-500">
                .sql / .ddl / .txt / .erreview 存档
              </div>
            </div>
          )}
        </div>

        {/* Parse-failure feedback: shown instead of silently discarding the
            current diagram; cleared on edit or reopen. */}
        {error && (
          <div
            className="px-5 py-2 text-[12px] leading-snug text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border-t border-rose-100 dark:border-rose-900/40"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-ink-100 dark:border-inkd-300 bg-ink-50/60 dark:bg-inkd-50/60 rounded-b-xl">
          <div className="flex items-center gap-3 text-[11px] text-ink-400 dark:text-inkd-500">
            {mode === 'sql' ? (
              <>
                <span>
                  <span className="font-mono text-ink-600 dark:text-inkd-700">{stats.lines}</span>{' '}
                  行
                </span>
                <span className="opacity-40">·</span>
                <span>
                  <span className="font-mono text-ink-600 dark:text-inkd-700">
                    {stats.chars.toLocaleString()}
                  </span>{' '}
                  字符
                </span>
              </>
            ) : (
              <span>
                {staged.length > 1
                  ? `${staged.length} 个存档将先安全合并，再一次性替换当前工作区`
                  : '导入存档将替换当前工作区（批注 / 决策 / 布局一并替换）'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-ink-600 dark:text-inkd-700 hover:bg-ink-100 dark:hover:bg-inkd-200 transition-colors"
              onClick={onClose}
            >
              取消
              <Kbd>Esc</Kbd>
            </button>
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md font-medium transition-colors',
                submittable
                  ? 'bg-ink-800 dark:bg-inkd-700 text-white dark:text-inkd-50 hover:bg-ink-900 dark:hover:bg-inkd-800'
                  : 'bg-ink-200 dark:bg-inkd-200 text-ink-400 dark:text-inkd-500 cursor-not-allowed',
              )}
              onClick={submit}
              disabled={!submittable}
              title={
                mode === 'archive'
                  ? staged.length > 1
                    ? '合并并导入存档 (⌘/Ctrl+Enter)'
                    : '导入存档，恢复评审现场 (⌘/Ctrl+Enter)'
                  : '解析并绘制 (⌘/Ctrl+Enter)'
              }
            >
              {mode === 'archive' ? (staged.length > 1 ? '合并并导入' : '导入存档') : '解析并绘制'}
              <Kbd inverted={submittable}>⌘↵</Kbd>
            </button>
          </div>
        </div>
        {unlockRequest && (
          <ArchivePasswordDialog
            mode="decrypt"
            fileName={unlockRequest.fileName}
            onClose={closeUnlockDialog}
            onConfirm={async (password) => {
              const result = await decryptWorkspaceArchive(unlockRequest.content, password);
              if (!result.ok) throw new Error(result.error);
              const resolve = unlockResolverRef.current;
              unlockResolverRef.current = null;
              setUnlockRequest(null);
              resolve?.(result.text);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ── archive tab body ──────────────────────────────────────────────────── */

/**
 * The 工作区存档 tab: an explicit, dedicated surface for restoring a review
 * session — either an empty drop-target state or a summary card of the staged
 * archive (what will be restored, from when, plus a read-only peek at its SQL).
 */
function ArchivePanel({
  staged,
  mergePreview,
  onPickFile,
  onRemove,
}: {
  staged: StagedArchive[];
  mergePreview: MergeArchivesResult | null;
  onPickFile: () => void;
  onRemove: (fileName: string) => void;
}) {
  if (staged.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="flex w-[420px] max-w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-ink-200 px-6 py-10 text-center dark:border-inkd-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-700 dark:bg-inkd-200 dark:text-inkd-800">
            <DropIcon />
          </div>
          <div className="text-sm font-medium text-ink-800 dark:text-inkd-800">
            导入或合并工作区存档（{ARCHIVE_EXTENSION}）
          </div>
          <div className="text-[11.5px] leading-relaxed text-ink-400 dark:text-inkd-500">
            支持密码加密存档与旧版未加密存档。可一次选择多个文件；合并时保留每个工作区的内部布局，
            仅在区域重叠时整体平移。
          </div>
          <SecondaryButton onClick={onPickFile} icon={<UploadIcon />}>
            选择一个或多个存档
          </SecondaryButton>
          <div className="text-[10.5px] text-ink-300 dark:text-inkd-500">
            也可以直接把文件拖到这个窗口
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-5">
      <div className="mx-auto flex w-[640px] max-w-full flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ink-700 dark:text-inkd-700">
            已选择 {staged.length} 个存档
          </div>
          <SecondaryButton onClick={onPickFile} icon={<UploadIcon />}>
            添加存档
          </SecondaryButton>
        </div>

        {mergePreview &&
          (mergePreview.ok ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] leading-relaxed text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-900/25 dark:text-emerald-300">
              将合并为 {mergePreview.summary.tableCount} 张表；
              {mergePreview.summary.shiftedGroups === 0
                ? '两个工作区均保留原始绝对坐标。'
                : `${mergePreview.summary.shiftedGroups} 个工作区会整体平移以避让重叠。`}
              {mergePreview.summary.warnings.map((warning) => (
                <div key={warning}>· {warning}</div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] leading-relaxed text-rose-800 dark:border-rose-700/50 dark:bg-rose-900/25 dark:text-rose-300">
              {mergePreview.error}
              {mergePreview.conflicts.map((conflict) => (
                <div key={conflict}>· {conflict}</div>
              ))}
            </div>
          ))}

        <div className="flex flex-col gap-2">
          {staged.map(({ archive, fileName, size, encrypted }) => {
            const st = archive.state;
            const metaRows: Array<[string, string]> = [
              ['表', String(archive.meta.tableCount || '?')],
              ['关系决策', String(Object.keys(st.decisions ?? {}).length)],
              ['手工连线', String((st.manualFks ?? []).length)],
              ['保存位置', String(Object.keys(st.nodePositions ?? {}).length)],
              ['手工路由', String(Object.keys(st.manualRoutes ?? {}).length)],
              [
                '导出时间',
                archive.meta.exportedAt
                  ? archive.meta.exportedAt.slice(0, 16).replace('T', ' ')
                  : '未知',
              ],
            ];
            return (
              <div
                key={fileName}
                className="rounded-lg border border-ink-100 bg-ink-50/40 p-3 dark:border-inkd-300 dark:bg-inkd-50/40"
              >
                <div className="flex items-center gap-1.5 text-[12px] text-ink-800 dark:text-inkd-800">
                  <FileIcon />
                  <span className="font-mono font-medium truncate">{fileName}</span>
                  <span className="text-ink-400 dark:text-inkd-500">· {formatBytes(size)}</span>
                  <span
                    className={clsx(
                      'rounded px-1.5 py-0.5 text-[9.5px] font-medium',
                      encrypted
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                        : 'bg-ink-100 text-ink-500 dark:bg-inkd-200 dark:text-inkd-600',
                    )}
                  >
                    {encrypted ? '已解密' : '兼容旧版'}
                  </span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:text-inkd-500 dark:hover:bg-inkd-200 dark:hover:text-inkd-800"
                    onClick={() => onRemove(fileName)}
                  >
                    移除
                  </button>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1.5">
                  {metaRows.map(([key, value]) => (
                    <div key={key} className="flex flex-col">
                      <dt className="text-[10px] text-ink-400 dark:text-inkd-500">{key}</dt>
                      <dd className="text-[12px] tabular-nums text-ink-800 dark:text-inkd-800">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {archive.downgraded && (
                  <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                    旧版本存档：仅 SQL 可用，不能参与保布局合并。
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {staged.length === 1 && (
          <div className="min-h-0">
            <div className="mb-1 text-[10.5px] text-ink-400 dark:text-inkd-500">
              SQL 预览（只读）
            </div>
            <pre className="max-h-36 overflow-auto rounded-md border border-ink-100 bg-white px-3 py-2 font-mono text-[11.5px] leading-[1.5] text-ink-700 dark:border-inkd-300 dark:bg-inkd-50 dark:text-inkd-700">
              {staged[0].archive.state.rawSql}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── secondary controls ────────────────────────────────────────────────── */

interface SecondaryButtonProps {
  onClick: () => void;
  icon?: React.ReactNode;
  chevron?: boolean;
  active?: boolean;
  variant?: 'default' | 'ghost';
  children: React.ReactNode;
}

function SecondaryButton({
  onClick,
  icon,
  chevron,
  active,
  variant = 'default',
  children,
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] rounded-md transition-colors',
        variant === 'default' &&
          'bg-white dark:bg-inkd-100 ring-1 ring-ink-200 dark:ring-inkd-300 text-ink-700 dark:text-inkd-800 hover:bg-ink-50 dark:hover:bg-inkd-200',
        variant === 'ghost' &&
          'text-ink-500 dark:text-inkd-600 hover:bg-ink-100 dark:hover:bg-inkd-200',
        active && variant === 'default' && 'bg-ink-100 dark:bg-inkd-200',
      )}
      onClick={onClick}
    >
      {icon}
      {children}
      {chevron && <ChevronDownIcon />}
    </button>
  );
}

function Kbd({ children, inverted }: { children: React.ReactNode; inverted?: boolean }) {
  return (
    <kbd
      className={clsx(
        'inline-block px-1 py-0 text-[10px] font-sans rounded border align-middle leading-[14px]',
        inverted
          ? // Sits inside the primary button: dark bg in light mode (white-ish
            // kbd), LIGHT bg in dark mode (inkd-700) — so the kbd flips too.
            'bg-white/15 text-white/90 border-white/20 dark:bg-black/10 dark:text-inkd-50/80 dark:border-black/20'
          : 'bg-white dark:bg-inkd-200 text-ink-400 dark:text-inkd-600 border-ink-200 dark:border-inkd-400',
      )}
    >
      {children}
    </kbd>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ── inline icons (local to this dialog; toolbar icons live in ./icons) ── */

function DatabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <ellipse cx="8" cy="3.5" rx="5" ry="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M3 3.5v9c0 1 2.24 1.8 5 1.8s5-.8 5-1.8v-9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M3 8c0 1 2.24 1.8 5 1.8s5-.8 5-1.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 10V3M8 3l-3 3M8 3l3 3M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 9.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M3 4.5l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 16V4M12 4l-4 4M12 4l4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
