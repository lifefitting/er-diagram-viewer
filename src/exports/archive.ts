import type { AppState } from '../store/types';
import { sanitizePersisted, migratePersisted, PERSIST_VERSION } from '../store/persistMigrate';

/**
 * Workspace archive (工作区存档) — the `.erreview` file format.
 *
 * A review session is multi-round: sessionStorage (deliberately) dies with the
 * tab, so the archive is the explicit, user-initiated way to keep a workspace
 * — and the minimal collaboration vehicle (send the file, the colleague opens
 * it and continues the review).
 *
 * The payload IS the persisted store subset (same shape the persist middleware
 * writes to sessionStorage), wrapped in an envelope with version metadata.
 * Reusing that shape means:
 *   - export needs no mapping — `getPersistedSnapshot()` is the payload;
 *   - import reuses the exact same validators as a page refresh
 *     (`sanitizePersisted` field-by-field, `migratePersisted` on a
 *     persist-version mismatch → degrade to rawSql only);
 *   - new persisted fields flow into archives automatically.
 */

export const ARCHIVE_FORMAT = 'erreview';
/** Envelope version — bump only if the WRAPPER changes shape. The payload's
 *  compatibility is governed by `persistVersion` (see PERSIST_VERSION). */
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_EXTENSION = '.erreview';

export interface ArchiveMeta {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  persistVersion: number;
  appVersion: string;
  exportedAt: string;
  tableCount: number;
}

type Persisted = Partial<AppState>;

export interface BuildArchiveOpts {
  appVersion: string;
  /** ISO timestamp; injectable for tests. */
  exportedAt: string;
  tableCount: number;
}

/** Serialize the persisted-store snapshot into `.erreview` JSON (pretty-printed
 *  — archives get diffed/inspected by humans; size is dominated by rawSql). */
export function buildWorkspaceArchive(
  snapshot: Record<string, unknown>,
  opts: BuildArchiveOpts,
): string {
  const envelope = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_VERSION,
    persistVersion: PERSIST_VERSION,
    appVersion: opts.appVersion,
    exportedAt: opts.exportedAt,
    tableCount: opts.tableCount,
    state: snapshot,
  };
  return JSON.stringify(envelope, null, 2);
}

export type ParseArchiveResult =
  | {
      ok: true;
      /** Validated persisted fields, safe to hand to `importWorkspace`. */
      state: Persisted & { rawSql: string };
      meta: ArchiveMeta;
      /** True when persistVersion mismatched: everything except rawSql was
       *  dropped (same policy as a stale sessionStorage snapshot). */
      downgraded: boolean;
    }
  | { ok: false; error: string };

/** Cheap sniff so the import dialog can route file content: SQL never starts
 *  with `{`. A `true` here only means "try parseWorkspaceArchive first". */
export function looksLikeArchive(text: string): boolean {
  return text.trimStart().startsWith('{');
}

export function parseWorkspaceArchive(text: string): ParseArchiveResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '不是有效的存档文件' };
  }
  const env = raw as Record<string, unknown>;
  if (env.format !== ARCHIVE_FORMAT) {
    return { ok: false, error: '不是 ER Diagram Viewer 的工作区存档（缺少 erreview 标记）' };
  }
  if (typeof env.formatVersion !== 'number' || env.formatVersion > ARCHIVE_VERSION) {
    return {
      ok: false,
      error: `存档格式版本 ${String(env.formatVersion)} 高于当前应用支持的 ${ARCHIVE_VERSION}，请升级应用后再导入`,
    };
  }

  // Payload compatibility follows the sessionStorage policy exactly:
  // mismatched persistVersion → keep rawSql only; matched → field-by-field
  // shape validation, malformed fields dropped to defaults.
  const downgraded = env.persistVersion !== PERSIST_VERSION;
  const state = downgraded
    ? sanitizePersisted(migratePersisted(env.state, Number(env.persistVersion)))
    : sanitizePersisted(env.state);

  if (typeof state.rawSql !== 'string' || state.rawSql.trim().length === 0) {
    return { ok: false, error: '存档中没有可用的 SQL 脚本' };
  }

  const meta: ArchiveMeta = {
    format: ARCHIVE_FORMAT,
    formatVersion: env.formatVersion,
    persistVersion: typeof env.persistVersion === 'number' ? env.persistVersion : -1,
    appVersion: typeof env.appVersion === 'string' ? env.appVersion : '',
    exportedAt: typeof env.exportedAt === 'string' ? env.exportedAt : '',
    tableCount: typeof env.tableCount === 'number' ? env.tableCount : 0,
  };
  return { ok: true, state: state as Persisted & { rawSql: string }, meta, downgraded };
}
