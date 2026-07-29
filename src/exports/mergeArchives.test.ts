import { describe, expect, it } from 'vitest';
import { buildWorkspaceArchive, parseWorkspaceArchive, type ParseArchiveResult } from './archive';
import { mergeWorkspaceArchives } from './mergeArchives';
import { runPipeline } from '../store/pipeline';
import { nodeId } from '../diagram/nodeId';
import { useApp } from '../store';
import type { PaletteName } from '../infer/inferModules';

type LoadedArchive = Extract<ParseArchiveResult, { ok: true }>;

function workspaceArchive({
  rawSql,
  palette,
  logicalKeys,
  nodePositions,
  manualRoutes = {},
}: {
  rawSql: string;
  palette: PaletteName;
  logicalKeys: string[];
  nodePositions: Record<string, { x: number; y: number }>;
  manualRoutes?: Record<string, { x: number; y: number }[]>;
}): LoadedArchive {
  const parsed = parseWorkspaceArchive(
    buildWorkspaceArchive(
      {
        rawSql,
        palette,
        logicalKeys,
        nodePositions,
        manualRoutes,
        viewport: { x: 10, y: 20, zoom: 2 },
      },
      {
        appVersion: 'test',
        exportedAt: '2026-07-29T00:00:00.000Z',
        tableCount: Object.keys(nodePositions).length,
      },
    ),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}

const API_SQL = [
  'CREATE TABLE api_clients (id BIGINT PRIMARY KEY, appid VARCHAR(64) UNIQUE);',
  'CREATE TABLE api_requests (id BIGINT PRIMARY KEY, appid VARCHAR(64));',
].join('\n');
const APP_SQL = [
  'CREATE TABLE app_users (id BIGINT PRIMARY KEY, appid VARCHAR(64) UNIQUE);',
  'CREATE TABLE app_events (id BIGINT PRIMARY KEY, appid VARCHAR(64));',
].join('\n');

function nonOverlappingArchives(): { api: LoadedArchive; app: LoadedArchive } {
  return {
    api: workspaceArchive({
      rawSql: API_SQL,
      palette: 'professional',
      logicalKeys: ['appid'],
      nodePositions: {
        [nodeId('api_clients')]: { x: 0, y: 0 },
        [nodeId('api_requests')]: { x: 400, y: 0 },
      },
    }),
    app: workspaceArchive({
      rawSql: APP_SQL,
      palette: 'vibrant',
      logicalKeys: [],
      nodePositions: {
        [nodeId('app_users')]: { x: 0, y: 1000 },
        [nodeId('app_events')]: { x: 400, y: 1000 },
      },
      manualRoutes: {
        'app_users.id->app_events.id': [
          { x: 0, y: 950 },
          { x: 400, y: 950 },
        ],
      },
    }),
  };
}

function tinyArchive(
  table: string,
  position: { x: number; y: number },
  route?: { key: string; points: { x: number; y: number }[] },
): LoadedArchive {
  return workspaceArchive({
    rawSql: `CREATE TABLE ${table} (id INT PRIMARY KEY);`,
    palette: 'professional',
    logicalKeys: [],
    nodePositions: { [nodeId(table)]: position },
    manualRoutes: route ? { [route.key]: route.points } : {},
  });
}

describe('mergeWorkspaceArchives', () => {
  it('merges non-overlapping workspaces without moving either original layout', () => {
    const { api, app } = nonOverlappingArchives();
    const result = mergeWorkspaceArchives([
      { archive: api, fileName: 'api-diagram-workspace.erreview' },
      { archive: app, fileName: 'app-diagram-workspace.erreview' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.tableCount).toBe(4);
    expect(result.summary.shiftedGroups).toBe(0);
    expect(result.state.workspaceGroups).toHaveLength(2);
    expect(result.state.workspaceGroups.map((group) => group.translation)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(result.state.nodePositions).toEqual({
      ...api.state.nodePositions,
      ...app.state.nodePositions,
    });
    expect(Object.keys(result.state.nodePositions ?? {})).toHaveLength(4);
    expect(result.state.manualRoutes).toEqual(app.state.manualRoutes);
    expect(result.state.viewport).toBeNull();
    expect(result.state.workspaceGroups.map((group) => group.palette)).toEqual([
      'professional',
      'vibrant',
    ]);
  });

  it('keeps imported logical keys inside their source workspace', () => {
    const { api, app } = nonOverlappingArchives();
    const result = mergeWorkspaceArchives([
      { archive: api, fileName: 'api.erreview' },
      { archive: app, fileName: 'app.erreview' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pipeline = runPipeline(
      result.state.rawSql,
      result.state.palette ?? 'professional',
      result.state.logicalKeys,
      result.state.workspaceGroups,
    );
    const logical = pipeline.inferred.filter((fk) => fk.kind === 'logical');
    expect(logical.length).toBeGreaterThan(0);
    const owner = new Map(
      result.state.workspaceGroups.flatMap((group) =>
        group.nodeIds.map((id) => [id, group.id] as const),
      ),
    );
    expect(
      logical.filter((fk) => owner.get(nodeId(fk.fromTable)) !== owner.get(nodeId(fk.toTable))),
    ).toHaveLength(0);
  });

  it('imports merged state into the store in one workspace replacement', () => {
    const { api, app } = nonOverlappingArchives();
    const result = mergeWorkspaceArchives([
      { archive: api, fileName: 'api.erreview' },
      { archive: app, fileName: 'app.erreview' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const previousEpoch = useApp.getState().workspaceEpoch;
    useApp.getState().importWorkspace(result.state);
    const imported = useApp.getState();

    expect(imported.workspaceEpoch).toBe(previousEpoch + 1);
    expect(imported.schema?.tables).toHaveLength(4);
    expect(imported.workspaceGroups).toHaveLength(2);
    expect(Object.keys(imported.nodePositions)).toHaveLength(4);
    expect(imported.inferred.filter((fk) => fk.kind === 'logical').length).toBeGreaterThan(0);
  });

  it('moves an overlapping source as one rigid body, including routes and its camera', () => {
    const first = tinyArchive('alpha', { x: 0, y: 0 });
    const second = tinyArchive(
      'beta',
      { x: 0, y: 0 },
      {
        key: 'beta.id->beta.id',
        points: [
          { x: -10, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    );
    const result = mergeWorkspaceArchives([
      { archive: first, fileName: 'alpha.erreview' },
      { archive: second, fileName: 'beta.erreview' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const delta = result.state.workspaceGroups[1].translation;
    expect(delta).not.toEqual({ x: 0, y: 0 });
    expect(result.state.nodePositions?.['t:beta']).toEqual({ x: delta.x, y: delta.y });
    expect(result.state.manualRoutes?.['beta.id->beta.id']).toEqual([
      { x: -10 + delta.x, y: delta.y },
      { x: 10 + delta.x, y: delta.y },
    ]);
    expect(result.state.workspaceGroups[1].viewport).toEqual({
      x: 10 - delta.x * 2,
      y: 20 - delta.y * 2,
      zoom: 2,
    });
  });

  it('rejects case-insensitive table collisions instead of silently aliasing state', () => {
    const upper = tinyArchive('Users', { x: 0, y: 0 });
    const lower = tinyArchive('users', { x: 500, y: 0 });
    const result = mergeWorkspaceArchives([
      { archive: upper, fileName: 'one.erreview' },
      { archive: lower, fileName: 'two.erreview' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('同名表');
  });
});
