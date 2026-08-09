import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadSampleWorkspace } from './helpers/workspace';

async function firstVisibleOverlay(page: Page): Promise<Locator> {
  const overlays = page.locator('[data-node-id]');
  const count = await overlays.count();
  for (let index = 0; index < count; index += 1) {
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
    if (receivesPointer) return overlay;
  }
  throw new Error(`No visible table overlay found among ${count} candidates`);
}

async function enterEditMode(page: Page) {
  await page.locator('button').filter({ hasText: '编辑' }).first().click();
}

async function enterReadMode(page: Page) {
  await page.locator('button').filter({ hasText: '阅读' }).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loadSampleWorkspace(page);
});

test('field controls mount only in edit mode without shifting table content', async ({ page }) => {
  await enterEditMode(page);
  const overlay = await firstVisibleOverlay(page);
  const row = overlay.locator('.field-row').first();
  const columnName = row.locator('.column-name');

  await enterReadMode(page);
  const readOverlayBox = await overlay.boundingBox();
  const readColumnBox = await columnName.boundingBox();
  await expect(page.locator('.connect-dot-hit')).toHaveCount(0);
  await expect(page.locator('.column-reorder-hit')).toHaveCount(0);

  await enterEditMode(page);
  const editOverlayBox = await overlay.boundingBox();
  const editColumnBox = await columnName.boundingBox();
  expect(readOverlayBox).not.toBeNull();
  expect(readColumnBox).not.toBeNull();
  expect(editOverlayBox).not.toBeNull();
  expect(editColumnBox).not.toBeNull();
  if (!readOverlayBox || !readColumnBox || !editOverlayBox || !editColumnBox) return;

  expect(editOverlayBox.width).toBeCloseTo(readOverlayBox.width, 1);
  expect(editOverlayBox.height).toBeCloseTo(readOverlayBox.height, 1);
  expect(editColumnBox.x).toBeCloseTo(readColumnBox.x, 1);
  expect(editColumnBox.y).toBeCloseTo(readColumnBox.y, 1);
  await expect(row.locator('.column-reorder-hit')).toHaveCount(1);
  await expect(row.locator('.connect-dot-hit')).toHaveCount(2);
});

test('field controls do not keep animations running while idle', async ({ page }) => {
  await enterEditMode(page);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => ({
    controls: document.querySelectorAll('.connect-dot-hit, .column-reorder-hit').length,
    runningAnimations: document
      .getAnimations()
      .filter((animation) => animation.playState === 'running').length,
    runningControlAnimations: document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          animation instanceof CSSAnimation &&
          animation.animationName === 'field-control-pulse',
      ).length,
  }));

  expect(stats.controls).toBeGreaterThan(0);
  expect(stats.runningAnimations).toBe(0);
  expect(stats.runningControlAnimations).toBe(0);
});

test('field controls remain discoverable on row hover and keyboard focus', async ({ page }) => {
  await enterEditMode(page);
  const overlay = await firstVisibleOverlay(page);
  const row = overlay.locator('.field-row').first();
  await row.hover();

  const reorder = row.locator('.column-reorder-hit');
  const connectDots = row.locator('.connect-dot-hit');
  await expect(reorder).toBeVisible();
  await expect(connectDots).toHaveCount(2);
  await expect(connectDots.first()).toBeVisible();
  await expect(connectDots.last()).toBeVisible();
  const pseudoContent = await connectDots.first().evaluate((element) => ({
    outer: getComputedStyle(element, '::before').content,
    inner: getComputedStyle(element, '::after').content,
  }));
  expect(pseudoContent.outer).not.toBe('none');
  expect(pseudoContent.inner).not.toBe('none');

  await page.mouse.move(5, 5);
  await reorder.focus();
  await expect(reorder).toBeVisible();
  await expect(reorder).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(connectDots.first()).toBeFocused();
});

test('dragging a field grip reorders columns in edit mode', async ({ page }) => {
  await enterEditMode(page);
  const overlay = await firstVisibleOverlay(page);
  const rows = overlay.locator('[data-column-order-col]');
  await expect.poll(() => rows.count()).toBeGreaterThan(2);

  const before = await rows.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.columnOrderCol ?? ''),
  );
  const tableName = await overlay.getAttribute('data-table-name');
  expect(tableName).not.toBeNull();
  if (!tableName) return;
  const source = rows.nth(0);
  const target = rows.nth(2);
  const grip = source.locator('.column-reorder-hit');
  await source.hover();
  await expect
    .poll(() => grip.evaluate((element) => getComputedStyle(element).position))
    .toBe('relative');
  await grip.click();
  await expect(page.getByRole('dialog', { name: /评审批注/ })).toHaveCount(0);
  const gripBox = await grip.boundingBox();
  const targetBox = await target.boundingBox();
  expect(gripBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!gripBox || !targetBox) return;

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 8,
  });
  await expect(page.locator('body')).toHaveClass(/column-reorder-active/);
  await expect(target.locator('[data-column-drop-marker="bottom"]')).toHaveCount(1);
  await page.mouse.up();

  const expected = [before[1], before[2], before[0], ...before.slice(3)];
  const persistedOrder = await page.evaluate((name) => {
    const raw = sessionStorage.getItem('er-viewer:state:v1');
    if (!raw) return null;
    const persisted = JSON.parse(raw) as { state?: { columnOrders?: Record<string, string[]> } };
    return persisted.state?.columnOrders?.[name] ?? null;
  }, tableName);
  expect(persistedOrder).toEqual(expected);
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).dataset.columnOrderCol ?? ''),
      ),
    )
    .toEqual(expected);
});

test('a first pointer-down from outside the card starts connecting', async ({ page }) => {
  await enterEditMode(page);
  const overlay = await firstVisibleOverlay(page);
  const connect = overlay.locator('.field-row').first().locator('.connect-dot-hit').last();
  const box = await connect.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(box.x + box.width + 24, target.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await expect(page.locator('.cy-cursor-connecting')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cy-cursor-connecting')).toHaveCount(0);
  await page.mouse.up();
});

test('table drag sample moves a stable table handle', async ({ page }) => {
  await enterEditMode(page);
  const overlay = await firstVisibleOverlay(page);
  const handle = overlay.locator('[data-table-drag-handle]');
  const before = await handle.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;

  const start = { x: before.x + before.width * 0.65, y: before.y + before.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 15, start.y + step * 8.75);
    await page.waitForTimeout(20);
  }

  const fpsHud = page.locator('[data-interaction-fps]');
  await expect(fpsHud).toHaveAttribute('data-interaction-kind', 'table');
  await expect(fpsHud).toContainText(/\d+(?:\.\d+)?\s*FPS/);
  const canvas = await page.locator('.cy-container').boundingBox();
  const hudBox = await fpsHud.boundingBox();
  expect(canvas).not.toBeNull();
  expect(hudBox).not.toBeNull();
  if (canvas && hudBox) {
    expect(Math.abs(hudBox.x + hudBox.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(2);
  }

  await page.waitForTimeout(300);
  await expect(fpsHud).toHaveAttribute('data-fps-value', '0.0');
  for (let step = 9; step <= 14; step += 1) {
    await page.mouse.move(start.x + step * 15, start.y + step * 8.75);
    await page.waitForTimeout(20);
  }
  await expect
    .poll(async () => Number((await fpsHud.getAttribute('data-fps-value')) ?? 0))
    .toBeGreaterThan(0);

  await page.mouse.up();
  await expect(fpsHud).toHaveCount(0);

  const after = await handle.boundingBox();
  expect(after).not.toBeNull();
  if (!after) return;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(20);
});

test('pan updates only overlay root geometry, not field content', async ({ page }) => {
  const overlay = await firstVisibleOverlay(page);
  await enterReadMode(page);
  const before = await overlay.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;

  await overlay.evaluate((element) => {
    const state = { contentMutations: 0 };
    const observer = new MutationObserver((records) => {
      state.contentMutations += records.filter(
        (record) => record.type === 'childList' || record.type === 'characterData',
      ).length;
    });
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    Object.assign(element, { __overlayMutationState: state, __overlayObserver: observer });
  });

  const canvas = await page.locator('.cy-container').boundingBox();
  expect(canvas).not.toBeNull();
  if (!canvas) return;
  const start = { x: canvas.x + canvas.width * 0.45, y: canvas.y + canvas.height * 0.55 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 20, start.y + step * 11.25);
    await page.waitForTimeout(20);
  }

  const fpsHud = page.locator('[data-interaction-fps]');
  await expect(fpsHud).toHaveAttribute('data-interaction-kind', 'pan');
  await expect(fpsHud).toContainText(/\d+(?:\.\d+)?\s*FPS/);

  await page.mouse.up();
  await expect(fpsHud).toHaveCount(0);

  const after = await overlay.boundingBox();
  expect(after).not.toBeNull();
  if (!after) return;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(20);
  const contentMutations = await overlay.evaluate((element) => {
    const tracked = element as HTMLElement & {
      __overlayMutationState: { contentMutations: number };
      __overlayObserver: MutationObserver;
    };
    tracked.__overlayObserver.disconnect();
    return tracked.__overlayMutationState.contentMutations;
  });
  expect(contentMutations).toBe(0);
});

test('horizontal and vertical wheel scrolling show live canvas FPS', async ({ page }) => {
  const overlay = await firstVisibleOverlay(page);
  await enterReadMode(page);
  const canvas = await page.locator('.cy-container').boundingBox();
  expect(canvas).not.toBeNull();
  if (!canvas) return;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);

  const fpsHud = page.locator('[data-interaction-fps]');
  const scrollAndAssert = async (deltaX: number, deltaY: number, axis: 'x' | 'y') => {
    const before = await overlay.boundingBox();
    expect(before).not.toBeNull();
    if (!before) return;

    for (let step = 0; step < 8; step += 1) {
      await page.mouse.wheel(deltaX, deltaY);
      await page.waitForTimeout(20);
    }

    await expect(fpsHud).toHaveAttribute('data-interaction-kind', 'pan');
    await expect
      .poll(async () => Number((await fpsHud.getAttribute('data-fps-value')) ?? 0))
      .toBeGreaterThan(0);

    const after = await overlay.boundingBox();
    expect(after).not.toBeNull();
    if (after) expect(Math.abs(after[axis] - before[axis])).toBeGreaterThan(10);

    await page.waitForTimeout(260);
    await expect(fpsHud).toHaveCount(0);
  };

  await scrollAndAssert(14, 0, 'x');
  await scrollAndAssert(0, 14, 'y');
});
