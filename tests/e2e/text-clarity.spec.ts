import { expect, test, type Page } from '@playwright/test';
import { buildWorkspaceArchive } from '../../src/exports/archive';

const position = { x: 400.3, y: 280.6 };
const viewport = { x: 10.3, y: 20.6, zoom: 0.85 };
const archive = buildWorkspaceArchive(
  {
    rawSql: 'CREATE TABLE clarity_check (id BIGINT PRIMARY KEY, title VARCHAR(100));',
    nodePositions: { 't:clarity_check': position },
    viewport,
  },
  { appVersion: '0.3.6', exportedAt: '2026-09-11T00:00:00.000Z', tableCount: 1 },
);

async function loadWorkspace(page: Page) {
  await page.goto('/');
  await page.locator('[data-empty-workspace]').evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'clarity.erreview'));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, archive);
  await expect(page.locator('[data-node-id]')).toHaveCount(1);
}

async function expectCrispOrigin(page: Page, ratio: number) {
  await expect
    .poll(() =>
      page.locator('[data-node-id]').evaluate((element) => {
        const { x, y } = element.getBoundingClientRect();
        const ratio = window.devicePixelRatio;
        return Math.max(
          Math.abs(x * ratio - Math.round(x * ratio)),
          Math.abs(y * ratio - Math.round(y * ratio)),
        );
      }),
    )
    .toBeLessThan(0.001);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(ratio);
  const style = await page.locator('[data-node-id]').evaluate((element) => {
    const style = getComputedStyle(element);
    return { willChange: style.willChange, transform: (element as HTMLElement).style.transform };
  });
  expect(style.willChange).toBe('auto');
  expect(style.transform).toMatch(/^translate\(/);
}

for (const ratio of [1, 1.25, 2]) {
  test.describe(`text rendering at DPR ${ratio}`, () => {
    test.use({ deviceScaleFactor: ratio });
    test('restores fractional layouts and remains aligned after scrolling and zooming', async ({
      page,
    }) => {
      await loadWorkspace(page);
      await expectCrispOrigin(page, ratio);
      const savedPosition = () =>
        page.evaluate(
          () =>
            JSON.parse(sessionStorage.getItem('er-viewer:state:v1')!).state.nodePositions[
              't:clarity_check'
            ],
        );
      expect(await savedPosition()).toEqual(position);
      const card = page.locator('[data-node-id]');
      const before = await card.boundingBox();
      await card.hover();
      await page.mouse.wheel(31.3, 27.7);
      await expect.poll(async () => (await card.boundingBox())?.x).not.toBe(before?.x);
      await expectCrispOrigin(page, ratio);
      const scrolled = await card.boundingBox();
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -15);
      await page.keyboard.up('Control');
      await expect.poll(async () => (await card.boundingBox())?.width).not.toBe(scrolled?.width);
      await expectCrispOrigin(page, ratio);
      expect(await savedPosition()).toEqual(position);
      await page.reload();
      await expectCrispOrigin(page, ratio);
      expect(await savedPosition()).toEqual(position);
    });
  });
}

test('moving between display densities re-aligns without changing the workspace camera', async ({
  page,
  context,
}) => {
  await loadWorkspace(page);
  await expectCrispOrigin(page, 1);
  const cdp = await context.newCDPSession(page);
  const size = page.viewportSize()!;
  for (const ratio of [2, 1.25, 1]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...size,
      deviceScaleFactor: ratio,
      mobile: false,
    });
    // CDP changes devicePixelRatio but does not itself dispatch resolution
    // media-query changes. Invalidate emulated media to deliver the browser's
    // change notification without moving/resizing the workspace viewport.
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
    await expectCrispOrigin(page, ratio);
  }
  const saved = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('er-viewer:state:v1')!).state,
  );
  expect(saved.nodePositions['t:clarity_check']).toEqual(position);
  expect(saved.viewport).toEqual(viewport);
});
