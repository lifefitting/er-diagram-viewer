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
export const ARCHIVE_ENCRYPTION = 'AES-GCM';
const ARCHIVE_KDF = 'PBKDF2-SHA-256';
const PBKDF2_ITERATIONS = 210_000;

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

interface EncryptedArchiveEnvelope {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  encrypted: true;
  encryption: {
    algorithm: typeof ARCHIVE_ENCRYPTION;
    kdf: typeof ARCHIVE_KDF;
    iterations: number;
    salt: string;
    iv: string;
  };
  ciphertext: string;
}

export type DecryptArchiveResult = { ok: true; text: string } | { ok: false; error: string };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveArchiveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: ARCHIVE_ENCRYPTION, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt the complete plain archive envelope. Only the encryption metadata
 * remains readable; SQL, review decisions and layout all stay inside AES-GCM. */
export async function encryptWorkspaceArchive(text: string, password: string): Promise<string> {
  if (!password) throw new Error('存档密码不能为空');
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持工作区加密');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveArchiveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: ARCHIVE_ENCRYPTION, iv },
    key,
    new TextEncoder().encode(text),
  );
  const envelope: EncryptedArchiveEnvelope = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_VERSION,
    encrypted: true,
    encryption: {
      algorithm: ARCHIVE_ENCRYPTION,
      kdf: ARCHIVE_KDF,
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope, null, 2);
}

export function isEncryptedWorkspaceArchive(text: string): boolean {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return value?.format === ARCHIVE_FORMAT && value.encrypted === true;
  } catch {
    return false;
  }
}

/** Decrypt an AES-GCM archive back to the legacy/plain archive JSON. Bad
 * passwords and tampered payloads intentionally share one error message. */
export async function decryptWorkspaceArchive(
  text: string,
  password: string,
): Promise<DecryptArchiveResult> {
  if (!password) return { ok: false, error: '请输入存档密码' };
  try {
    const envelope = JSON.parse(text) as Partial<EncryptedArchiveEnvelope>;
    const encryption = envelope.encryption;
    if (
      envelope.format !== ARCHIVE_FORMAT ||
      envelope.encrypted !== true ||
      encryption?.algorithm !== ARCHIVE_ENCRYPTION ||
      encryption.kdf !== ARCHIVE_KDF ||
      !Number.isInteger(encryption.iterations) ||
      (encryption.iterations ?? 0) < 100_000 ||
      (encryption.iterations ?? 0) > 1_000_000 ||
      typeof encryption.salt !== 'string' ||
      typeof encryption.iv !== 'string' ||
      typeof envelope.ciphertext !== 'string'
    ) {
      return { ok: false, error: '加密存档格式无效' };
    }
    const salt = base64ToBytes(encryption.salt);
    const iv = base64ToBytes(encryption.iv);
    if (salt.length !== 16 || iv.length !== 12) {
      return { ok: false, error: '加密存档格式无效' };
    }
    const key = await deriveArchiveKey(password, salt, encryption.iterations!);
    if (!globalThis.crypto?.subtle) {
      return { ok: false, error: '当前浏览器不支持工作区加密' };
    }
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: ARCHIVE_ENCRYPTION, iv: iv as BufferSource },
      key,
      base64ToBytes(envelope.ciphertext) as BufferSource,
    );
    return { ok: true, text: new TextDecoder().decode(plain) };
  } catch {
    return { ok: false, error: '密码错误或存档已损坏' };
  }
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
  if (env.encrypted === true) {
    return { ok: false, error: '该工作区存档已加密，请输入密码后导入' };
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
