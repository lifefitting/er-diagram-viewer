import { expect, test, type Page } from '@playwright/test';
import { buildWorkspaceArchive } from '../../src/exports/archive';
import { PALETTE_OPTIONS } from '../../src/infer/paletteCatalog';
import { MODULE_PALETTES } from '../../src/infer/inferModules';
import { loadSampleWorkspace } from './helpers/workspace';

async function headerColors(page: Page) {
  return page.locator('[data-table-drag-handle]').evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.querySelector('[title]')?.getAttribute('title'),
      background: (element as HTMLElement).style.backgroundColor,
      text: (element as HTMLElement).style.color,
    })),
  );
}

test('all eight palettes work in light/dark mode, fit the menu, and survive session restore', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await loadSampleWorkspace(page);
  for (const theme of ['亮色', '暗色']) {
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    for (const option of PALETTE_OPTIONS) {
      await page.getByRole('button', { name: '切换模块色系', exact: true }).click();
      const menu = page.getByRole('listbox', { name: '模块色系' });
      await expect(menu.getByRole('option')).toHaveCount(8);
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      if (option.id === 'qingci')
        await page.screenshot({ path: testInfo.outputPath(`palette-menu-${theme}.png`) });
      await menu.getByRole('option', { name: new RegExp(`^${option.label}`) }).click();
      const first = MODULE_PALETTES[option.id][0];
      const rgb = (hex: string) =>
        `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      await expect
        .poll(async () =>
          (await headerColors(page)).some(
            (c) => c.background === rgb(first.header) && c.text === rgb(first.text),
          ),
        )
        .toBe(true);
      await expect
        .poll(async () => [...new Set((await headerColors(page)).map((c) => c.text))])
        .toEqual([rgb(option.id === 'pastel' ? '#1f2937' : '#ffffff')]);
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem('er-viewer:state:v1')!).state.palette,
        ),
      ).toBe(option.id);
      if (['qingci', 'twilight', 'contrast'].includes(option.id)) {
        const before = await headerColors(page);
        await page.reload();
        await expect.poll(() => headerColors(page)).toEqual(before);
        await expect(page.locator('[data-empty-workspace]')).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: '切换模块色系', exact: true }),
        ).toHaveAttribute('title', `模块色系: ${option.label}`);
        await page.screenshot({ path: testInfo.outputPath(`${option.id}-${theme}.png`) });
      }
    }
  }
});

test('a new palette restores directly from an archive without changing saved layout or notes', async ({
  page,
}) => {
  const snapshot = {
    rawSql: 'CREATE TABLE palette_restore (id INT PRIMARY KEY);',
    palette: 'twilight',
    theme: 'dark',
    nodePositions: { 't:palette_restore': { x: 420.3, y: 260.6 } },
    viewport: { x: 18.3, y: 24.6, zoom: 0.85 },
    fieldNotes: {
      'palette_restore::id': {
        text: '保留批注',
        updatedAt: '2026-09-11T00:00:00.000Z',
        severity: 'warn',
        status: 'open',
      },
    },
  };
  const archive = buildWorkspaceArchive(snapshot, {
    appVersion: '0.3.6',
    exportedAt: '2026-09-11T00:00:00.000Z',
    tableCount: 1,
  });
  await page.goto('/');
  await page.locator('[data-empty-workspace]').evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'palette.erreview'));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, archive);
  await expect(page.locator('[data-node-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '切换模块色系', exact: true })).toHaveAttribute(
    'title',
    '模块色系: 暮光',
  );
  const saved = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('er-viewer:state:v1')!).state,
  );
  // Import deliberately retains the user's local theme preference; the
  // archive palette, review notes and geometry are workspace data.
  expect(saved.theme).toBe('system');
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== 'theme') expect(saved[key]).toEqual(value);
  }
});
