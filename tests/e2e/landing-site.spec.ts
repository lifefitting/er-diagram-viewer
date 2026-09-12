import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { assembleSite } from '../../scripts/assemble-site.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const projectPrefix = '/er-diagram-viewer/';
let server: Server;
let origin: string;
let site: string;

// Build once for both URL layouts. Serve actual assembled files with 404s,
// without Vite's SPA fallback or mocked asset/HTML responses.
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(120_000);
  execFileSync('bun', ['run', 'build'], { cwd: root, timeout: 90_000, stdio: 'pipe' });
  site = await mkdtemp(join(tmpdir(), 'er-landing-site-'));
  await assembleSite(site);
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.js': 'text/javascript',
    '.css': 'text/css',
  };
  server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      if (pathname.startsWith(projectPrefix)) pathname = `/${pathname.slice(projectPrefix.length)}`;
      let file = resolve(site, `.${pathname}`);
      if (file !== site && !file.startsWith(`${site}${sep}`)) {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing static test server port');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const prefix of ['/', projectPrefix]) {
  test(`assembled landing loads its SVG, opens the original, and launches the real app at ${prefix}`, async ({
    page,
    request,
  }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${origin}${prefix}`);
    const image = page.locator('.demo-image');
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBe(2302);
    await expect(image).toHaveAttribute('src', './assets/er-demo.svg');
    const asset = await request.get(`${origin}${prefix}assets/er-demo.svg`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['content-type']).toContain('image/svg+xml');
    expect(await asset.body()).toEqual(await readFile(join(root, 'docs/assets/er-demo.svg')));
    expect((await request.get(`${origin}${prefix}assets/er-demo.png`)).status()).toBe(404);

    const popupReady = page.waitForEvent('popup');
    await page.getByRole('link', { name: '查看示例 ER 图大图（新标签页）', exact: true }).click();
    const popup = await popupReady;
    await popup.waitForLoadState();
    expect(popup.url()).toBe(`${origin}${prefix}assets/er-demo.svg`);
    await expect(popup.locator('svg')).toHaveAttribute('viewBox', '-66 213 2302 844');
    await popup.close();

    await page.locator('.hero').getByRole('link', { name: '打开工作台', exact: true }).click();
    await expect(page).toHaveURL(`${origin}${prefix}app/`);
    await expect(page.locator('[data-empty-workspace]')).toBeVisible();
    await page.getByRole('button', { name: '查看示例 ER 图', exact: true }).click();
    await expect(page.locator('[data-node-id]')).toHaveCount(14);
    expect(failures).toEqual([]);
  });
}
