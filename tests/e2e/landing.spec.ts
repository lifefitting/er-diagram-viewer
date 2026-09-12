import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PALETTE_OPTIONS } from '../../src/infer/paletteCatalog';

// Serve the exact static file at a Pages-style subpath, without Vite's HTML
// transforms or injected scripts. Relative app links must keep this prefix.
const landingHtml = readFileSync(new URL('../../landing/index.html', import.meta.url), 'utf8');
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
const landingPath = '/er-diagram-viewer/';

test.use({ javaScriptEnabled: false });

test.beforeEach(async ({ page }) => {
  await page.route(`**${landingPath}`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: landingHtml }),
  );
});

for (const width of [320, 390, 768, 1280]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`landing stays readable at ${width}px in ${colorScheme} mode without JavaScript`, async ({
      page,
    }, testInfo) => {
      const height = width >= 1000 ? 720 : 844;
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(landingPath);

      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const hero = page.getByRole('region', { name: '把 SQL DDL 变成 可评审的 ER 图' });
      await expect(hero.locator('.badge')).toContainText(`v${version}`);
      await expect(hero.locator('.hero-values dt')).toHaveText([
        '看清关系',
        '组织评审',
        '带走成果',
      ]);
      expect((await hero.locator('.lead').innerText()).replace(/\s/g, '').length).toBeLessThan(90);

      const launch = hero.getByRole('link', { name: '打开工作台', exact: true });
      const launchBox = await launch.boundingBox();
      expect(launchBox).not.toBeNull();
      expect(launchBox!.y + launchBox!.height).toBeLessThan(height);
      await expect(launch).toHaveAttribute('href', './app/');
      expect(await launch.evaluate((link) => (link as HTMLAnchorElement).pathname)).toBe(
        `${landingPath}app/`,
      );
      // Keep the primary action legible in both themes (WCAG AA normal text).
      const contrast = await launch.evaluate((link) => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
          const linear = rgb.map((channel) => {
            const s = channel / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const style = getComputedStyle(link);
        const a = luminance(style.color);
        const b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const demo = page.locator('.demo-image');
      await expect(demo).toBeVisible();
      await expect
        .poll(() => demo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBe(2302);
      await expect(page.locator('.demo-image-link')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)',
      );
      await page.screenshot({ path: testInfo.outputPath('hero.png') });
      await page.locator('.demo-figure').screenshot({ path: testInfo.outputPath('demo.png') });

      await page.getByRole('navigation').getByRole('link', { name: '新变化' }).click();
      await expect(page).toHaveURL(/#updates$/);
      const updates = page.locator('#updates');
      await expect(updates.locator('article')).toHaveCount(4);
      // The sticky navigation must not obscure an anchor's heading.
      const headingBox = await page.locator('#updates-title').boundingBox();
      const navBox = await page.getByRole('navigation').boundingBox();
      expect(headingBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
      await page.screenshot({ path: testInfo.outputPath('updates.png') });
    });
  }
}

test('landing describes the merged features and real first-session entry paths', async ({
  page,
}) => {
  await page.goto(landingPath);
  const updates = page.locator('#updates');
  for (const { label } of PALETTE_OPTIONS) await expect(updates).toContainText(label);
  for (const feature of [
    '非 Retina',
    '自定义模块',
    'HEX',
    '色板来源',
    '搜索回车',
    '模块定位',
    'SVG',
  ]) {
    await expect(updates).toContainText(feature);
  }
  await expect(page.locator('.start-paths li')).toHaveCount(3);
  await expect(page.locator('#quickstart')).toContainText('不显示新手引导');
  await expect(page.locator('.release-note')).toContainText('离线版功能以');
  expect(landingHtml).not.toMatch(/样例 schema 在首屏自动加载|五套调色板|最多 5 秒/);
  await expect(page.locator('script, link[rel="stylesheet"], link[rel="preload"]')).toHaveCount(0);
  const brokenAnchors = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute('href')!.slice(1))
        .filter((id) => !document.getElementById(id)),
    );
  expect(brokenAnchors).toEqual([]);
});

test('source-file preview loads the original SVG and opens the full-size image without JavaScript', async ({
  page,
}) => {
  await page.goto(new URL('../../landing/index.html', import.meta.url).href);
  const image = page.locator('.demo-image');
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(2302);
  await expect(image).toHaveAttribute('height', '844');
  const fullSize = page.getByRole('link', { name: '查看大图 · SVG（新标签页） ↗', exact: true });
  await fullSize.focus();
  const popupReady = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupReady;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(new URL('../../docs/assets/er-demo.svg', import.meta.url).href);
  await expect(popup.locator('svg')).toHaveAttribute('viewBox', '-66 213 2302 844');
  await popup.close();
});

test('self-hosting instructions expand with the keyboard and keep mobile content contained', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(landingPath);
  const details = page.locator('.quick-delivery details');
  await expect(details.locator('pre')).toBeHidden();
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details.locator('pre')).toBeVisible();
  await expect(details.locator('pre')).toContainText('bun run build:single');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('self-hosting.png') });
  await page.keyboard.press('Enter');
  await expect(details.locator('pre')).toBeHidden();
});
