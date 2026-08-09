import { describe, expect, it } from 'vitest';
import { buildWorkspaceArchive } from '../../exports/archive';
import { inspectImportContent } from './importFiles';

describe('shared import content inspection', () => {
  it('keeps SQL as text instead of routing it through archive parsing', () => {
    const result = inspectImportContent('CREATE TABLE users (id INT);', 'schema.sql', 29);
    expect(result.archive).toBeNull();
    expect(result.content).toContain('CREATE TABLE users');
  });

  it('parses a valid workspace archive without committing it', () => {
    const text = buildWorkspaceArchive(
      { rawSql: 'CREATE TABLE users (id INT);', nodePositions: { 't:users': { x: 10, y: 20 } } },
      {
        appVersion: '0.3.6',
        exportedAt: '2026-08-09T00:00:00.000Z',
        tableCount: 1,
      },
    );
    const result = inspectImportContent(text, 'review.erreview', text.length);
    expect(result.archive?.ok).toBe(true);
    if (result.archive?.ok) {
      expect(result.archive.state.rawSql).toContain('CREATE TABLE users');
      expect(result.archive.state.nodePositions).toEqual({ 't:users': { x: 10, y: 20 } });
    }
  });

  it('reports JSON that is not an ER workspace as an invalid archive candidate', () => {
    const result = inspectImportContent('{"hello":"world"}', 'unknown.json', 17);
    expect(result.archive).toEqual({
      ok: false,
      error: '不是 ER Diagram Viewer 的工作区存档（缺少 erreview 标记）',
    });
  });
});
