export type StartupView = 'loading' | 'empty' | 'workspace' | 'recovery';

interface StartupStateInput {
  hydrated: boolean;
  startupComplete: boolean;
  rawSql: string;
  tableCount: number;
}

/** Resolve the startup surface without ever treating an unhydrated store as empty. */
export function resolveStartupView({
  hydrated,
  startupComplete,
  rawSql,
  tableCount,
}: StartupStateInput): StartupView {
  if (!hydrated || !startupComplete) return 'loading';
  if (tableCount > 0) return 'workspace';
  if (rawSql.trim()) return 'recovery';
  return 'empty';
}
