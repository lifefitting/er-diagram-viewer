import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store';
import { parseSql } from '../../parser';
import { SAMPLE_ECOMMERCE, SAMPLE_BLOG } from '../../samples';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface LoadedFile {
  name: string;
  size: number;
}

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
  const currentSql = useApp((s) => s.rawSql);
  const [text, setText] = useState(currentSql);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const samplesMenuRef = useRef<HTMLDivElement | null>(null);

  // Resync the editor with persisted SQL each time the dialog opens — the user
  // may have run a different setSql in between, and we don't want to discard
  // their current schema if they cancel out.
  useEffect(() => {
    if (open) {
      setText(currentSql);
      setLoadedFile(null);
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

  const submit = useCallback(() => {
    if (!text.trim()) return;
    // Pre-flight parse before committing: `setSql` unconditionally clears
    // decisions, layout and the recycle bin, so garbage input (or a parser
    // throw) must not be allowed to wipe the current workspace.
    try {
      const parsed = parseSql(text);
      if (parsed.tables.length === 0) {
        setError('未解析出任何表：请确认粘贴的是 CREATE TABLE / ALTER TABLE 脚本。当前图保持不变。');
        return;
      }
      setSql(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`解析失败：${msg} —— 当前图保持不变。`);
      return;
    }
    onClose();
  }, [setSql, text, onClose]);

  // Keyboard shortcuts: Esc closes (or first closes the samples dropdown if
  // open), ⌘/Ctrl+Enter submits. Bound at window level so the textarea,
  // buttons, or focus-less states all work.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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
  }, [open, onClose, submit, samplesOpen]);

  // Close samples dropdown on outside click.
  useEffect(() => {
    if (!samplesOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!samplesMenuRef.current?.contains(e.target as Node)) setSamplesOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [samplesOpen]);

  const handleFile = useCallback(async (file: File) => {
    const content = await file.text();
    setText(content);
    setLoadedFile({ name: file.name, size: file.size });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

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
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const stats = useMemo(() => {
    if (!text) return { lines: 0, chars: 0 };
    return { lines: text.split('\n').length, chars: text.length };
  }, [text]);

  const submittable = text.trim().length > 0;

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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100 dark:border-inkd-300">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-ink-800 dark:bg-inkd-700 text-white dark:text-inkd-50 flex items-center justify-center">
              <DatabaseIcon />
            </div>
            <div>
              <h2
                id="sql-dialog-title"
                className="text-sm font-semibold text-ink-800 dark:text-inkd-800 leading-tight"
              >
                导入 SQL 脚本
              </h2>
              <div className="text-[11px] text-ink-400 dark:text-inkd-500 leading-tight mt-0.5">
                粘贴 DDL · 上传 .sql 文件 · 或将文件拖拽到任意位置
              </div>
            </div>
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

        {/* Toolbar */}
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

          <input
            type="file"
            accept=".sql,.ddl,.txt,text/plain"
            hidden
            ref={fileInputRef}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await handleFile(f);
              // Reset so picking the same file again still fires change.
              e.target.value = '';
            }}
          />
        </div>

        {/* Editor */}
        <div className="relative flex-1 min-h-[280px]">
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
          {dragOver && (
            <div className="absolute inset-3 rounded-lg border-2 border-dashed border-ink-400 dark:border-inkd-500 bg-white/95 dark:bg-inkd-50/95 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <div className="w-12 h-12 rounded-full bg-ink-100 dark:bg-inkd-200 flex items-center justify-center text-ink-700 dark:text-inkd-800">
                <DropIcon />
              </div>
              <div className="text-sm font-medium text-ink-800 dark:text-inkd-800">
                释放以加载文件
              </div>
              <div className="text-[11px] text-ink-400 dark:text-inkd-500">.sql / .ddl / .txt</div>
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
            <span>
              <span className="font-mono text-ink-600 dark:text-inkd-700">{stats.lines}</span> 行
            </span>
            <span className="opacity-40">·</span>
            <span>
              <span className="font-mono text-ink-600 dark:text-inkd-700">
                {stats.chars.toLocaleString()}
              </span>{' '}
              字符
            </span>
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
              title="解析并绘制 (⌘/Ctrl+Enter)"
            >
              解析并绘制
              <Kbd inverted={submittable}>⌘↵</Kbd>
            </button>
          </div>
        </div>
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
