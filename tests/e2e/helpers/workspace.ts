import { expect, type Page } from '@playwright/test';

/** Start a deterministic sample workspace for canvas-focused regressions. */
export async function loadSampleWorkspace(page: Page): Promise<void> {
  const launcher = page.getByRole('button', { name: '查看示例 ER 图', exact: true });
  if ((await launcher.count()) > 0) await launcher.click();
  await page.locator('.cy-container canvas').first().waitFor({ state: 'visible' });
  await expect(page.locator('[data-node-id]')).toHaveCount(14);
}
