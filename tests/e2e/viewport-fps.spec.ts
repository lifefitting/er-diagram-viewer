import { expect, test, type Page } from '@playwright/test';
import { loadSampleWorkspace } from './helpers/workspace';

const hud = (page: Page) => page.locator('[data-interaction-fps]');
const firstPosition = (page: Page) =>
  page
    .locator('[data-node-id]')
    .first()
    .evaluate((element) => (element as HTMLElement).style.transform);
async function expectLiveFps(page: Page) {
  await expect(hud(page)).toHaveAttribute('data-interaction-kind', 'pan');
  await expect
    .poll(async () => Number((await hud(page).getAttribute('data-fps-value')) ?? 0), {
      intervals: [20, 40, 60],
    })
    .toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loadSampleWorkspace(page);
  // Let the initial restore/fit complete before observing a new interaction.
  await page.waitForTimeout(300);
  await expect(hud(page)).toHaveCount(0);
});

test('search Enter and Shift+Enter show live FPS during camera navigation, typing does not', async ({
  page,
}) => {
  await page.getByLabel('搜索范围').selectOption('table');
  const search = page.getByPlaceholder('搜索表名');
  await search.fill('order');
  await expect(page.getByTitle('当前匹配 / 匹配总数')).toHaveText(/^0\/[2-9]/);
  await expect(hud(page)).toHaveCount(0);
  for (const key of ['Enter', 'Enter', 'Shift+Enter']) {
    const before = await firstPosition(page);
    await search.press(key);
    await expectLiveFps(page);
    expect(await firstPosition(page)).not.toBe(before);
    await expect(hud(page)).toHaveCount(0);
  }
  await search.fill('does_not_exist_999');
  await search.press('Enter');
  await expect(page.getByTitle('当前匹配 / 匹配总数')).toHaveText('0/0');
  await expect(hud(page)).toHaveCount(0);
});

test('module locate shows FPS throughout its animation and hides when settled', async ({
  page,
}, testInfo) => {
  const before = await firstPosition(page);
  await page
    .getByRole('button', { name: /^定位模块 / })
    .first()
    .click();
  await expectLiveFps(page);
  expect(await firstPosition(page)).not.toBe(before);
  await page.waitForTimeout(230);
  // Continuous camera events must not reset the sample or stop at a wheel timeout.
  await expectLiveFps(page);
  await page.screenshot({ path: testInfo.outputPath('module-locate-fps.png') });
  await expect(hud(page)).toHaveCount(0);
  await page.waitForTimeout(250);
  await expect(hud(page)).toHaveCount(0);
});

test('zoom buttons and view commands display the HUD, but no-op zoom does not', async ({
  page,
}) => {
  const zoom = page.getByTitle('缩放选项');
  for (const name of ['缩小', '放大']) {
    const before = await zoom.textContent();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(zoom).not.toHaveText(before!);
    await expect(hud(page)).toBeVisible();
    // A one-frame change may show '--'; never manufacture an FPS from idle rAFs.
    await expect(hud(page)).toHaveCount(0);
  }
  await zoom.click();
  await page.getByRole('menuitem', { name: /^全览/ }).click();
  await expect(hud(page)).toBeVisible();
  await expect(hud(page)).toHaveCount(0);
  await zoom.click();
  await page.getByRole('menuitem', { name: /^缩放至 100%/ }).click();
  await expect(zoom).toHaveText('100%');
  await expect(hud(page)).toBeVisible();
  await expect(hud(page)).toHaveCount(0);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(hud(page)).toHaveCount(0);
});

test('pinch-style wheel zoom and manual canvas pan both show live FPS', async ({ page }) => {
  const canvas = (await page.locator('.cy-container').boundingBox())!;
  const point = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.7 };
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  for (let step = 0; step < 8; step++) {
    await page.mouse.wheel(0, 8);
    await page.waitForTimeout(20);
  }
  await page.keyboard.up('Control');
  await expectLiveFps(page);
  await expect(hud(page)).toHaveCount(0);
  await page.locator('button').filter({ hasText: '阅读' }).first().click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(point.x + step * 8, point.y + step * 4);
    await page.waitForTimeout(20);
  }
  await expectLiveFps(page);
  await page.mouse.up();
  await expect(hud(page)).toHaveCount(0);
});
