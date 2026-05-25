import { useEffect } from 'react';
import { useApp } from '../../store';
import type { ThemePreference } from '../../store/types';

/**
 * Resolve a `ThemePreference` to a concrete `'light' | 'dark'`. `system`
 * consults the matchMedia query — the result is whatever the OS reports at
 * the moment this is called.
 */
function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply the user's theme preference to the document. Toggles the `dark` class
 * on `<html>` (the Tailwind class-strategy hook), and — when the preference
 * is `system` — subscribes to `prefers-color-scheme` so OS-level theme flips
 * propagate live without requiring a reload.
 *
 * Also stamps `color-scheme` on `<html>` so native form controls and the
 * browser's own scrollbar/UI follow the theme.
 */
export function useApplyTheme(): void {
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const concrete = resolveTheme(theme);
      root.classList.toggle('dark', concrete === 'dark');
      root.style.colorScheme = concrete;
    };
    apply();
    if (theme !== 'system') return;
    // `system`: re-apply whenever the OS preference changes.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}
