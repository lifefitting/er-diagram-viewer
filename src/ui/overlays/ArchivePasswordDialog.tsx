import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export function ArchivePasswordDialog({
  mode,
  fileName,
  onConfirm,
  onClose,
}: {
  mode: 'encrypt' | 'decrypt';
  fileName?: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [busy, onClose]);

  const submit = async () => {
    if ((mode === 'encrypt' && password.length < 6) || (mode === 'decrypt' && !password)) {
      setError(mode === 'encrypt' ? '密码至少需要 6 个字符' : '请输入存档密码');
      return;
    }
    if (mode === 'encrypt' && password !== confirmation) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/55 backdrop-blur-sm dark:bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-password-title"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <div
        className="w-[390px] max-w-[92vw] rounded-xl border border-ink-200 bg-white p-5 shadow-2xl dark:border-inkd-300 dark:bg-inkd-100"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-lg text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            {mode === 'encrypt' ? '🔒' : '🔑'}
          </div>
          <div className="min-w-0">
            <h2
              id="archive-password-title"
              className="text-sm font-semibold text-ink-800 dark:text-inkd-800"
            >
              {mode === 'encrypt' ? '设置工作区存档密码' : '解锁工作区存档'}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-ink-400 dark:text-inkd-500">
              {mode === 'encrypt'
                ? 'SQL、评审记录与布局将使用 AES-GCM 加密'
                : fileName || '请输入导出时设置的密码'}
            </p>
          </div>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-600 dark:text-inkd-700">
              密码
            </span>
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'encrypt' ? 'new-password' : 'current-password'}
              className="h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 dark:border-inkd-300 dark:bg-inkd-50 dark:text-inkd-800 dark:focus:border-sky-600"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              disabled={busy}
            />
          </label>
          {mode === 'encrypt' && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink-600 dark:text-inkd-700">
                再次输入
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className="h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 dark:border-inkd-300 dark:bg-inkd-50 dark:text-inkd-800 dark:focus:border-sky-600"
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError(null);
                }}
                disabled={busy}
              />
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-500 dark:text-inkd-600">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            显示密码
          </label>
          {mode === 'encrypt' && (
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              密码不会写入存档，也无法找回。请通过安全渠道告知协作者。
            </p>
          )}
          {error && (
            <div className="text-[11px] text-rose-600 dark:text-rose-300" role="alert">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="h-8 rounded-md px-3 text-[12px] text-ink-500 hover:bg-ink-50 dark:text-inkd-600 dark:hover:bg-inkd-200"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="submit"
              className={clsx(
                'h-8 rounded-md px-3 text-[12px] font-medium transition-colors',
                'bg-sky-600 text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60',
              )}
              disabled={busy}
            >
              {busy ? '处理中…' : mode === 'encrypt' ? '加密并导出' : '解锁'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
