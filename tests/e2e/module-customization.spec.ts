import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { buildWorkspaceArchive } from '../../src/exports/archive';
import { PALETTE_OPTIONS } from '../../src/infer/paletteCatalog';
import { MODULE_PALETTES } from '../../src/infer/inferModules';

const snapshot = {
  rawSql:
    'CREATE TABLE users (id INT PRIMARY KEY); CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users(id)); CREATE TABLE audit (id INT PRIMARY KEY);',
  palette: 'professional',
  nodePositions: {
    't:users': { x: 480, y: 200 },
    't:orders': { x: 800, y: 200 },
    't:audit': { x: 1100, y: 200 },
  },
  viewport: { x: 0, y: 0, zoom: 1 },
  fieldNotes: {
    'users::id': { text: '保留的评审', updatedAt: '2026-09-12', severity: 'warn', status: 'open' },
  },
};
const header = (page: Page, table: string) =>
  page.locator(`[data-node-id="t:${table}"] [data-table-drag-handle]`);
const persisted = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('er-viewer:state:v1')!).state);
const style = (page: Page, table: string) =>
  header(page, table).evaluate((el) => ({
    background: (el as HTMLElement).style.backgroundColor,
    color: (el as HTMLElement).style.color,
  }));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const archive = buildWorkspaceArchive(snapshot, {
    appVersion: '0.3.6',
    exportedAt: '2026-09-12T00:00:00.000Z',
    tableCount: 3,
  });
  await page.locator('[data-empty-workspace]').evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'customization-test.erreview'));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, archive);
  await expect(page.locator('[data-node-id]')).toHaveCount(3);
});

async function selectPair(page: Page) {
  await page.locator('button').filter({ hasText: '编辑' }).first().click();
  // Shift-click both cards: a plain click also centers the canvas, changing
  // the viewport that the workspace-preservation assertions expect unchanged.
  await header(page, 'users').click({ modifiers: ['Shift'] });
  await header(page, 'orders').click({ modifiers: ['Shift'] });
  await expect(page.getByText('已选 2 张 · 拖动整组移动')).toBeVisible();
}

test('palette source labels follow all eight palettes without attributing custom colors to them', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const openEditor = page.getByRole('button', { name: '修改「Audit」的颜色', exact: true });
  await openEditor.click();
  const editor = page.getByRole('dialog', { name: '修改「Audit」的颜色', exact: true });
  await editor
    .getByRole('group', { name: '自定义颜色', exact: true })
    .getByLabel('模块颜色 HEX')
    .fill('#880044');
  await editor.getByRole('button', { name: '应用', exact: true }).click();
  const savedColors = (await persisted(page)).moduleColors;
  await openEditor.click();
  for (const theme of ['亮色', '暗色']) {
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    for (const option of PALETTE_OPTIONS) {
      await page.getByRole('button', { name: '切换模块色系', exact: true }).click();
      await page
        .getByRole('listbox', { name: '模块色系' })
        .getByRole('option', { name: new RegExp(`^${option.label}`) })
        .click();
      const source = editor.getByRole('group', {
        name: `色板来源：${option.label} · 当前画布配色`,
        exact: true,
      });
      await expect(source).toBeVisible();
      await expect(source.getByRole('button')).toHaveCount(12);
      expect(
        await source
          .getByRole('button')
          .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))),
      ).toEqual(MODULE_PALETTES[option.id].map((slot) => `使用颜色 ${slot.header}`));
      // The source describes the presets only; custom controls are a sibling group.
      await expect(source.locator('input')).toHaveCount(0);
      await expect(
        editor.getByRole('group', { name: '自定义颜色', exact: true }).getByLabel('模块颜色 HEX'),
      ).toHaveValue('#880044');
      await expect(editor.getByRole('combobox')).toHaveCount(0);
      expect((await persisted(page)).moduleColors).toEqual(savedColors);
      expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const legend = source.locator('legend');
      const box = (await legend.boundingBox())!;
      const editorBox = (await editor.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(editorBox.x + editorBox.width);
      if (option.id === 'contrast')
        await editor.screenshot({
          path: testInfo.outputPath(`palette-source-${theme}.png`),
          animations: 'disabled',
        });
    }
  }
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  expect((await persisted(page)).moduleColors).toEqual(savedColors);
});

test('custom module creation, color drafts, session restore and SVG export preserve the workspace', async ({
  page,
}, testInfo) => {
  await selectPair(page);
  const select = page.getByLabel('批量修改所属模块');
  await select.selectOption('__custom__');
  const dialog = page.getByRole('dialog', { name: '自定义模块', exact: true });
  await expect(dialog.getByRole('button', { name: '创建并移入' })).toBeDisabled();
  await dialog.getByLabel('自定义模块名称').fill('订单中心');
  await page.screenshot({ path: testInfo.outputPath('create-module.png') });
  await dialog.getByRole('button', { name: '创建并移入' }).click();
  await expect(header(page, 'users')).toContainText('订单中心');
  await expect(header(page, 'orders')).toContainText('订单中心');
  const saved = await persisted(page);
  const key = saved.moduleOverrides['t:users'];
  expect(saved.moduleOverrides['t:orders']).toBe(key);
  expect(saved.customModules[key].label).toBe('订单中心');
  const baseline = await style(page, 'users');
  const unaffected = await style(page, 'audit');
  const colors = page.getByRole('button', { name: '修改「订单中心」的颜色', exact: true });
  await colors.click();
  const editor = page.getByRole('dialog', { name: '修改「订单中心」的颜色', exact: true });
  await editor.getByLabel('模块颜色 HEX').fill('#ffff00');
  await expect(editor.getByText(/为保持统一字色清晰/)).toBeVisible();
  await expect(editor.locator('[data-module-color-preview]')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await editor.getByLabel('模块颜色 HEX').fill('#880044');
  expect(await style(page, 'users')).toEqual(baseline);
  expect((await persisted(page)).moduleColors).toEqual({});
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  expect(await style(page, 'users')).toEqual(baseline);
  await colors.click();
  await editor.getByLabel('自选模块颜色').fill('#880044');
  await page.screenshot({ path: testInfo.outputPath('module-color-light.png') });
  await editor.getByRole('button', { name: '应用', exact: true }).click();
  await expect
    .poll(() => style(page, 'users'))
    .toEqual({ background: 'rgb(136, 0, 68)', color: 'rgb(255, 255, 255)' });
  expect(await style(page, 'orders')).toEqual(await style(page, 'users'));
  expect(await style(page, 'audit')).toEqual(unaffected);
  await page.reload();
  await expect(header(page, 'users')).toContainText('订单中心');
  await expect
    .poll(() => style(page, 'orders'))
    .toEqual({ background: 'rgb(136, 0, 68)', color: 'rgb(255, 255, 255)' });
  const restored = await persisted(page);
  expect(restored.moduleColors[key]).toBe('#880044');
  for (const field of ['rawSql', 'nodePositions', 'viewport', 'fieldNotes'])
    expect(restored[field]).toEqual(snapshot[field as keyof typeof snapshot]);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('option', { name: '暗色', exact: true }).click();
  await colors.click();
  await page.screenshot({ path: testInfo.outputPath('module-color-dark.png') });
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: /导出/ }).first().click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /SVG 矢量图/ }).click();
  const download = await downloadPromise;
  const svg = await readFile((await download.path())!, 'utf8');
  expect(svg).toContain('订单中心');
  expect(svg).toContain('fill="#880044"');
  expect(svg).not.toContain(key);
  await colors.click();
  await editor.getByRole('button', { name: '恢复默认颜色', exact: true }).click();
  await expect.poll(() => style(page, 'users')).toEqual(baseline);
  expect((await persisted(page)).moduleColors).toEqual({});
});

test('cancel, existing-module moves, same-name reuse and automatic grouping still work', async ({
  page,
}) => {
  await selectPair(page);
  const select = page.getByLabel('批量修改所属模块');
  await select.selectOption('__custom__');
  await page.getByLabel('自定义模块名称', { exact: true }).fill('不要创建');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '自定义模块', exact: true })).toHaveCount(0);
  expect((await persisted(page)).customModules).toEqual({});
  await expect(page.getByText('已选 2 张 · 拖动整组移动')).toBeVisible();
  await select.selectOption('__custom__');
  await page.getByLabel('自定义模块名称', { exact: true }).fill('业务中心');
  await page.getByRole('button', { name: '创建并移入' }).click();
  const key = (await persisted(page)).moduleOverrides['t:users'];
  await select.selectOption('__auto__');
  await expect(header(page, 'users')).not.toContainText('业务中心');
  expect((await persisted(page)).moduleOverrides).toEqual({});
  // The empty definition is reusable without another UUID or lost custom color.
  await select.selectOption('__custom__');
  await page.getByLabel('自定义模块名称', { exact: true }).fill('业务中心');
  await page.getByRole('button', { name: '创建并移入' }).click();
  expect(Object.keys((await persisted(page)).customModules)).toEqual([key]);
  const existing = await select
    .locator('option')
    .evaluateAll(
      (options) =>
        options
          .map((o) => (o as HTMLOptionElement).value)
          .find((value) => value && !value.startsWith('__') && !value.startsWith('custom:'))!,
    );
  await select.selectOption(existing);
  expect((await persisted(page)).moduleOverrides['t:users']).toBe(existing);
  expect((await persisted(page)).moduleOverrides['t:orders']).toBe(existing);
});
