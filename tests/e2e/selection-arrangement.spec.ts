import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadSampleWorkspace } from './helpers/workspace';

const alignmentOperations = [
  'align-left',
  'align-horizontal-center',
  'align-right',
  'align-top',
  'align-vertical-center',
  'align-bottom',
] as const;

const distributionOperations = ['distribute-horizontal', 'distribute-vertical'] as const;

async function visibleTableHandles(page: Page, required: number): Promise<Locator[]> {
  const overlays = page.locator('[data-node-id]');
  const handles: Locator[] = [];
  const count = await overlays.count();

  for (let index = 0; index < count && handles.length < required; index += 1) {
    const overlay = overlays.nth(index);
    const box = await overlay.boundingBox();
    if (!box || box.width <= 30 || box.height <= 10 || box.x <= 5 || box.y <= 55) continue;

    const handle = overlay.locator('[data-table-drag-handle]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) continue;
    const point = {
      x: handleBox.x + handleBox.width * 0.65,
      y: handleBox.y + handleBox.height / 2,
    };
    const receivesPointer = await handle.evaluate((element, coordinates) => {
      const hit = document.elementFromPoint(coordinates.x, coordinates.y);
      return hit === element || (hit instanceof Node && element.contains(hit));
    }, point);
    if (receivesPointer) handles.push(handle);
  }

  if (handles.length < required) {
    throw new Error(`Only found ${handles.length} visible table handles; expected ${required}`);
  }
  return handles;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loadSampleWorkspace(page);
  await page.locator('button').filter({ hasText: '编辑' }).first().click();
});

test('multi-selection arrange menus show an SVG for every operation', async ({ page }) => {
  const handles = await visibleTableHandles(page, 3);
  await handles[0].click();
  await handles[1].click({ modifiers: ['Shift'] });
  await handles[2].click({ modifiers: ['Shift'] });
  await expect(page.getByText('已选 3 张 · 拖动整组移动')).toBeVisible();

  await page.getByRole('button', { name: /^对齐/ }).click();
  const alignmentMenu = page.getByRole('menu', { name: '对齐选中的表' });
  await expect(alignmentMenu).toBeVisible();
  await expect(alignmentMenu.locator('svg[data-arrangement-icon]')).toHaveCount(6);
  for (const operation of alignmentOperations) {
    const option = alignmentMenu.locator(`[data-arrangement-option="${operation}"]`);
    await expect(option).toBeVisible();
    await expect(option.locator(`svg[data-arrangement-icon="${operation}"]`)).toHaveCount(1);
  }

  await page.getByRole('button', { name: /^分布/ }).click();
  const distributionMenu = page.getByRole('menu', { name: '分布选中的表' });
  await expect(alignmentMenu).toHaveCount(0);
  await expect(distributionMenu).toBeVisible();
  await expect(distributionMenu.locator('svg[data-arrangement-icon]')).toHaveCount(2);
  for (const operation of distributionOperations) {
    const option = distributionMenu.locator(`[data-arrangement-option="${operation}"]`);
    await expect(option).toBeVisible();
    await expect(option.locator(`svg[data-arrangement-icon="${operation}"]`)).toHaveCount(1);
  }
});
