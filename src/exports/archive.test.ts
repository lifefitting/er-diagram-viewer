import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceArchive,
  parseWorkspaceArchive,
  looksLikeArchive,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  encryptWorkspaceArchive,
  decryptWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from './archive';
import { PERSIST_VERSION } from '../store/persistMigrate';

const SNAPSHOT = {
  rawSql: 'CREATE TABLE a (id INT PRIMARY KEY);',
  palette: 'professional',
  theme: 'dark',
  sidebarCollapsed: false,
  decisions: { 'a.x->b.y': 'accept' },
  manualFks: [
    {
      fromTable: 'a',
      fromColumns: ['x'],
      toTable: 'b',
      toColumns: ['y'],
      source: 'manual',
      kind: 'logical',
    },
  ],
  logicalKeys: ['out_trade_no'],
  moduleOverrides: { 't:a': 'account' },
  fieldNotes: {
    'a::id': {
      text: '建议改雪花 ID',
      updatedAt: '2026-07-12T00:00:00.000Z',
      severity: 'warn',
      status: 'open',
    },
  },
  display: {
    onlyPk: false,
    showType: true,
    showComment: true,
    showIndex: true,
    showLowConfidence: false,
    showGrid: true,
    showLogicalLinks: true,
    showManualLinks: true,
  },
  collapsed: { a: true },
  tableWidths: { a: 280 },
  deletedTables: {
    't:b': { action: 'delete', updatedAt: '2026-07-12T07:30:00.000Z' },
  },
  nodePositions: { 't:a': { x: 12, y: 34 } },
  manualRoutes: {
    'a.x->b.y': [
      { x: 0, y: 0 },
      { x: 9, y: 9 },
    ],
  },
  viewport: { x: -50, y: 20, zoom: 1.25 },
};

const OPTS = { appVersion: '0.3.1', exportedAt: '2026-07-12T08:00:00.000Z', tableCount: 2 };

describe('workspace archive round-trip', () => {
  it('build → parse restores every persisted field and the meta', () => {
    const json = buildWorkspaceArchive(SNAPSHOT, OPTS);
    const parsed = parseWorkspaceArchive(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.downgraded).toBe(false);
    expect(parsed.state).toEqual(SNAPSHOT);
    expect(parsed.meta).toEqual({
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_VERSION,
      persistVersion: PERSIST_VERSION,
      appVersion: '0.3.1',
      exportedAt: '2026-07-12T08:00:00.000Z',
      tableCount: 2,
    });
  });

  it('drops malformed fields via the sessionStorage-grade validator', () => {
    const json = buildWorkspaceArchive(
      { ...SNAPSHOT, nodePositions: { 't:a': { x: 'nope', y: 1 } }, palette: 'rainbow' },
      OPTS,
    );
    const parsed = parseWorkspaceArchive(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect('nodePositions' in parsed.state).toBe(false); // → slice default
    expect('palette' in parsed.state).toBe(false);
    expect(parsed.state.fieldNotes).toEqual(SNAPSHOT.fieldNotes); // siblings survive
  });
});

describe('password-encrypted workspace archive', () => {
  it('encrypts the complete archive and decrypts it with the correct password', async () => {
    const plain = buildWorkspaceArchive(SNAPSHOT, OPTS);
    const encrypted = await encryptWorkspaceArchive(plain, 'review-2026');
    expect(isEncryptedWorkspaceArchive(encrypted)).toBe(true);
    expect(encrypted).not.toContain(SNAPSHOT.rawSql);
    expect(parseWorkspaceArchive(encrypted)).toEqual({
      ok: false,
      error: '该工作区存档已加密，请输入密码后导入',
    });

    const decrypted = await decryptWorkspaceArchive(encrypted, 'review-2026');
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) return;
    expect(parseWorkspaceArchive(decrypted.text)).toEqual(parseWorkspaceArchive(plain));
  });

  it('rejects a wrong password without exposing archive details', async () => {
    const encrypted = await encryptWorkspaceArchive(
      buildWorkspaceArchive(SNAPSHOT, OPTS),
      'correct-password',
    );
    expect(await decryptWorkspaceArchive(encrypted, 'wrong-password')).toEqual({
      ok: false,
      error: '密码错误或存档已损坏',
    });
  });
});

describe('workspace archive degrade & reject paths', () => {
  it('persistVersion mismatch degrades to rawSql only', () => {
    const json = buildWorkspaceArchive(SNAPSHOT, OPTS).replace(
      `"persistVersion": ${PERSIST_VERSION}`,
      '"persistVersion": 1',
    );
    const parsed = parseWorkspaceArchive(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.downgraded).toBe(true);
    expect(parsed.state).toEqual({ rawSql: SNAPSHOT.rawSql });
  });

  it('rejects non-JSON, non-archive JSON, and unknown future formatVersion', () => {
    expect(parseWorkspaceArchive('CREATE TABLE a (id INT);').ok).toBe(false);
    expect(parseWorkspaceArchive('{"hello":"world"}').ok).toBe(false);
    expect(parseWorkspaceArchive('[1,2,3]').ok).toBe(false);
    const future = buildWorkspaceArchive(SNAPSHOT, OPTS).replace(
      `"formatVersion": ${ARCHIVE_VERSION}`,
      `"formatVersion": ${ARCHIVE_VERSION + 1}`,
    );
    const res = parseWorkspaceArchive(future);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('升级');
  });

  it('rejects an archive without usable SQL (empty or missing rawSql)', () => {
    expect(
      parseWorkspaceArchive(buildWorkspaceArchive({ ...SNAPSHOT, rawSql: '  ' }, OPTS)).ok,
    ).toBe(false);
    const { rawSql: _sql, ...rest } = SNAPSHOT;
    expect(parseWorkspaceArchive(buildWorkspaceArchive(rest, OPTS)).ok).toBe(false);
  });
});

describe('looksLikeArchive sniff', () => {
  it('flags JSON-ish content and passes SQL through', () => {
    expect(looksLikeArchive('  {"format":"erreview"}')).toBe(true);
    expect(looksLikeArchive('CREATE TABLE t (id INT);')).toBe(false);
    expect(looksLikeArchive('-- comment\nCREATE TABLE t (id INT);')).toBe(false);
  });
});
