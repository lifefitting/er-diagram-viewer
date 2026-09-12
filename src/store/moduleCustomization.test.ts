import { beforeEach, describe, expect, it } from 'vitest';
import { useApp, getPersistedSnapshot } from './index';
import { MODULE_PALETTES } from '../infer/inferModules';
import { createModuleColor, contrastRatio } from '../infer/paletteColor';
import { buildWorkspaceArchive, parseWorkspaceArchive } from '../exports/archive';
import { mergeWorkspaceArchives } from '../exports/mergeArchives';
import { sanitizePersisted, PERSIST_VERSION } from './persistMigrate';
import { buildElements } from '../diagram/buildGraph';

const sql =
  'CREATE TABLE users (id INT PRIMARY KEY); CREATE TABLE user_profile (id INT PRIMARY KEY); CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users(id));';
const ids = ['t:users', 't:user_profile'];
const meta = { appVersion: '0.3.6', exportedAt: '2026-09-12T00:00:00.000Z', tableCount: 3 };
const load = (snapshot: Record<string, unknown>) => {
  const parsed = parseWorkspaceArchive(buildWorkspaceArchive(snapshot, meta));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
};

beforeEach(() => {
  useApp.getState().setSql(sql);
  useApp.getState().setPalette('professional');
});

describe('custom modules and colors', () => {
  it('creates one named module atomically, reuses its name, and displays the label instead of UUID', () => {
    const before = useApp.getState();
    const key = before.createModuleForTables(ids, '  订单中心  ');
    expect(key).toMatch(/^custom:[0-9a-f]{32}$/);
    expect(useApp.getState().modules.modules.get(key)?.tables).toEqual(['users', 'user_profile']);
    expect(useApp.getState().modules.modules.get(key)?.label).toBe('订单中心');
    expect(useApp.getState().createModuleForTables(['t:orders'], '订单中心')).toBe(key);
    expect(Object.keys(useApp.getState().customModules)).toEqual([key]);
    const s = useApp.getState();
    expect(s.rawSql).toBe(before.rawSql);
    expect(s.schema).toBe(before.schema);
    const { elements } = buildElements(s.schema!, [], {
      modules: s.modules,
      display: s.display,
      collapsed: {},
      tableWidths: {},
      decisions: {},
    });
    expect(elements.every((e) => e.data.moduleLabel === '订单中心')).toBe(true);
    expect(elements.every((e) => e.data.moduleKey === key)).toBe(true);
    s.assignTablesToModule(ids, null);
    expect(useApp.getState().modules.byTable.get('users')).toBe(
      before.modules.byTable.get('users'),
    );
  });

  it('retains names and requested colors through palette changes, inference and incremental SQL edits', () => {
    const key = useApp.getState().createModuleForTables(ids, '业务模块');
    useApp.getState().setModuleColor(key, '#FfFf00');
    const white = useApp.getState().modules.modules.get(key)!.color;
    expect(white.text).toBe('#ffffff');
    expect(white.header).not.toBe('#ffff00');
    expect(contrastRatio(white.header, white.text)).toBeGreaterThanOrEqual(4.5);
    useApp.getState().reparse();
    useApp.getState().setLogicalKeys([]);
    useApp.getState().setPalette('pastel');
    expect(useApp.getState().moduleColors[key]).toBe('#ffff00');
    expect(useApp.getState().modules.modules.get(key)!.color.text).toBe('#1f2937');
    useApp
      .getState()
      .updateSql(
        'CREATE TABLE users (id INT PRIMARY KEY, name TEXT); CREATE TABLE orders (id INT PRIMARY KEY);',
      );
    expect(useApp.getState().modules.modules.get(key)?.tables).toEqual(['users']);
    expect(useApp.getState().moduleOverrides['t:user_profile']).toBeUndefined();
    expect(useApp.getState().moduleColors[key]).toBe('#ffff00');
  });

  it('recolors an inferred module and its outgoing edges without mutating the palette or geometry', () => {
    const s = useApp.getState();
    const key = s.modules.byTable.get('orders')!;
    const baseline = s.modules.modules.get(key)!.color;
    const palette = JSON.stringify(MODULE_PALETTES);
    useApp.setState({
      nodePositions: { 't:orders': { x: 400.3, y: 280.6 } },
      manualRoutes: { route: [{ x: 1.2, y: 3.4 }] },
    });
    const geometry = useApp.getState();
    s.setModuleColor(key, '#880044');
    const next = useApp.getState();
    expect(next.schema).toBe(s.schema);
    expect(next.nodePositions).toBe(geometry.nodePositions);
    expect(next.manualRoutes).toBe(geometry.manualRoutes);
    expect(JSON.stringify(MODULE_PALETTES)).toBe(palette);
    const color = createModuleColor('#880044', undefined, '#ffffff');
    expect(next.modules.modules.get(key)?.color).toEqual(color);
    const { elements } = buildElements(next.schema!, next.schema!.explicitForeignKeys, {
      modules: next.modules,
      display: next.display,
      collapsed: {},
      tableWidths: {},
      decisions: {},
    });
    expect(elements.find((e) => e.group === 'edges')?.data).toMatchObject({
      color: color.edgeLight,
      colorDark: color.headerDark,
    });
    next.setModuleColor(key, null);
    expect(useApp.getState().moduleColors).toEqual({});
    expect(useApp.getState().modules.modules.get(key)?.color).toEqual(baseline);
  });

  it('round-trips customization with review and geometry, and imports old archives without leaking current choices', () => {
    const key = useApp.getState().createModuleForTables(ids, '评审分组');
    useApp.getState().setModuleColor(key, '#125678');
    useApp.setState({
      nodePositions: { 't:users': { x: 400.3, y: 280.6 } },
      fieldNotes: {
        'users::id': { text: '保留', updatedAt: '2026-09-12', severity: 'warn', status: 'open' },
      },
    });
    const snapshot = getPersistedSnapshot();
    const parsed = load(snapshot);
    expect(parsed.meta.persistVersion).toBe(PERSIST_VERSION);
    useApp.getState().setSql('CREATE TABLE fresh (id INT);');
    expect(useApp.getState().customModules).toEqual({});
    expect(useApp.getState().moduleColors).toEqual({});
    useApp.getState().importWorkspace(parsed.state);
    expect(getPersistedSnapshot().customModules).toEqual(snapshot.customModules);
    expect(getPersistedSnapshot().moduleColors).toEqual(snapshot.moduleColors);
    expect(getPersistedSnapshot().nodePositions).toEqual(snapshot.nodePositions);
    expect(getPersistedSnapshot().fieldNotes).toEqual(snapshot.fieldNotes);
    expect(useApp.getState().modules.modules.get(key)?.color.header).toBe('#125678');
    useApp.getState().importWorkspace(load({ rawSql: sql }).state);
    expect(useApp.getState().customModules).toEqual({});
    expect(useApp.getState().moduleColors).toEqual({});
  });

  it('rejects invalid inputs and drops malformed optional archive fields without losing other data', () => {
    const s = useApp.getState();
    for (const label of [' ', 'a'.repeat(65), 'invalid\nname'])
      expect(() => s.createModuleForTables(ids, label)).toThrow();
    expect(() => s.createModuleForTables(['missing'], '名称')).toThrow();
    for (const color of ['red', '#fff', '#gggggg', 'url(https://invalid)'])
      expect(() => s.setModuleColor('user', color)).toThrow();
    expect(useApp.getState()).toBe(s);
    const parsed = sanitizePersisted({
      rawSql: sql,
      customModules: { bad: { label: '', palette: 'rainbow', colorIndex: -1 } },
      moduleColors: { user: '#xyz' },
    });
    expect(parsed.rawSql).toBe(sql);
    expect(parsed).not.toHaveProperty('customModules');
    expect(parsed).not.toHaveProperty('moduleColors');
  });

  it('namespaces same-named custom modules and independent inferred colors when merging archives', () => {
    const source = (prefix: string, color: string) =>
      load({
        rawSql: `CREATE TABLE ${prefix}_first (id INT); CREATE TABLE ${prefix}_second (id INT);`,
        palette: 'professional',
        customModules: {
          'custom:shared': { label: '共同名称', palette: 'professional', colorIndex: 2 },
        },
        moduleOverrides: { [`t:${prefix}_first`]: 'custom:shared' },
        moduleColors: { 'custom:shared': color, [prefix]: '#334477' },
      });
    const a = source('alpha', '#880044'),
      b = source('beta', '#125678');
    const before = JSON.stringify([a, b]);
    const merged = mergeWorkspaceArchives([
      { fileName: 'a.erreview', archive: a },
      { fileName: 'b.erreview', archive: b },
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(JSON.stringify([a, b])).toBe(before);
    useApp.getState().importWorkspace(load(merged.state).state);
    useApp.getState().reparse();
    const modules = useApp.getState().modules;
    const ka = modules.byTable.get('alpha_first')!,
      kb = modules.byTable.get('beta_first')!;
    expect(ka).not.toBe(kb);
    expect(modules.modules.get(ka)?.color.header).toBe('#880044');
    expect(modules.modules.get(kb)?.color.header).toBe('#125678');
    for (const table of ['alpha_second', 'beta_second'])
      expect(modules.modules.get(modules.byTable.get(table)!)?.color.header).toBe('#334477');
    const imported = getPersistedSnapshot();
    expect(() => useApp.getState().createModuleForTables(['t:alpha_first'], '共同名称')).toThrow(
      /多个同名模块/,
    );
    expect(getPersistedSnapshot()).toEqual(imported);
  });

  it('rejects unsafe re-merges instead of silently dropping a saved scoped module color', () => {
    const first = mergeWorkspaceArchives([
      {
        fileName: 'a.erreview',
        archive: load({
          rawSql: 'CREATE TABLE alpha_first(id INT); CREATE TABLE alpha_second(id INT);',
          moduleColors: { alpha: '#880044' },
        }),
      },
      { fileName: 'b.erreview', archive: load({ rawSql: 'CREATE TABLE beta_first(id INT);' }) },
    ]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const sources = [
      { fileName: 'merged.erreview', archive: load(first.state) },
      { fileName: 'c.erreview', archive: load({ rawSql: 'CREATE TABLE third(id INT);' }) },
    ];
    const before = JSON.stringify(sources);
    const second = mergeWorkspaceArchives(sources);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain('无法保留');
      expect(second.conflicts.some((c) => c.includes('模块颜色'))).toBe(true);
    }
    expect(JSON.stringify(sources)).toBe(before);
  });
});
