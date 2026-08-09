import { expect, test } from '@playwright/test';
import { buildWorkspaceArchive, encryptWorkspaceArchive } from '../../src/exports/archive';
import { loadSampleWorkspace } from './helpers/workspace';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-empty-workspace]')).toBeVisible();
});

test('fresh sessions show three direct start paths without mounting the diagram engine', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: '查看示例 ER 图', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入 DDL', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复工作区', exact: true })).toBeVisible();
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await expect(page.locator('.cy-container')).toHaveCount(0);
  await expect(page.getByText('智能面板', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('搜索全部')).toHaveCount(0);

  await page.getByRole('button', { name: '恢复工作区', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '工作区存档' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the sample path explicitly loads the bundled 14-table workspace', async ({ page }) => {
  await loadSampleWorkspace(page);
  await expect(page.locator('[data-empty-workspace]')).toHaveCount(0);
  await expect(page.getByText('智能面板', { exact: true })).toBeVisible();
});

test('dropping plain DDL text parses immediately without opening the import dialog', async ({
  page,
}) => {
  const sql = 'CREATE TABLE quick_drop (id BIGINT PRIMARY KEY, title VARCHAR(100));';
  await page.locator('[data-empty-workspace]').evaluate((element, droppedSql) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', droppedSql);
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, sql);

  await page.locator('.cy-container canvas').first().waitFor({ state: 'visible' });
  await expect(page.locator('[data-node-id]')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '导入' })).toHaveCount(0);
});

test('dropping one workspace archive restores it directly and persists its workspace fields', async ({
  page,
}) => {
  const sql = 'CREATE TABLE restored_workspace (id BIGINT PRIMARY KEY);';
  const archive = buildWorkspaceArchive(
    {
      rawSql: sql,
      nodePositions: { 't:restored_workspace': { x: 420, y: 260 } },
      viewport: { x: 18, y: 24, zoom: 0.75 },
    },
    {
      appVersion: '0.3.6',
      exportedAt: '2026-08-09T00:00:00.000Z',
      tableCount: 1,
    },
  );

  await page.locator('[data-empty-workspace]').evaluate((element, archiveText) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([archiveText], 'restored.erreview', { type: 'application/json' }));
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, archive);

  await expect(page.locator('[data-node-id]')).toHaveCount(1);
  const persisted = await page.evaluate(() => {
    const raw = sessionStorage.getItem('er-viewer:state:v1');
    if (!raw) return null;
    return JSON.parse(raw) as {
      state?: { rawSql?: string; nodePositions?: Record<string, { x: number; y: number }> };
    };
  });
  expect(persisted?.state?.rawSql).toBe(sql);
  expect(persisted?.state?.nodePositions?.['t:restored_workspace']).toEqual({ x: 420, y: 260 });
});

test('a refreshed session restores without flashing the new-user launcher', async ({ page }) => {
  await loadSampleWorkspace(page);
  await page.addInitScript(() => {
    const tracked = window as Window & { __emptyWorkspaceSeen?: boolean };
    tracked.__emptyWorkspaceSeen = false;
    const markIfVisible = () => {
      if (document.querySelector('[data-empty-workspace]')) tracked.__emptyWorkspaceSeen = true;
    };
    new MutationObserver(markIfVisible).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', markIfVisible);
  });

  await page.reload();
  await page.locator('.cy-container canvas').first().waitFor({ state: 'visible' });
  await expect(page.locator('[data-node-id]')).toHaveCount(14);
  expect(
    await page.evaluate(
      () => (window as Window & { __emptyWorkspaceSeen?: boolean }).__emptyWorkspaceSeen,
    ),
  ).toBe(false);
});

test('an encrypted archive adds only the required password step before direct restore', async ({
  page,
}) => {
  const plain = buildWorkspaceArchive(
    { rawSql: 'CREATE TABLE encrypted_restore (id BIGINT PRIMARY KEY);' },
    {
      appVersion: '0.3.6',
      exportedAt: '2026-08-09T00:00:00.000Z',
      tableCount: 1,
    },
  );
  const encrypted = await encryptWorkspaceArchive(plain, 'secret-123');

  await page.locator('[data-empty-workspace]').evaluate((element, archiveText) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([archiveText], 'encrypted.erreview', { type: 'application/json' }));
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, encrypted);

  const passwordDialog = page.getByRole('dialog', { name: '解锁工作区存档' });
  await expect(passwordDialog).toBeVisible();
  await passwordDialog.locator('input[type="password"]').fill('secret-123');
  await passwordDialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(passwordDialog).toHaveCount(0);
  await expect(page.locator('[data-node-id]')).toHaveCount(1);
});

test('dropping multiple archives hands them to the existing merge preview', async ({ page }) => {
  const archiveA = buildWorkspaceArchive(
    { rawSql: 'CREATE TABLE workspace_a (id BIGINT PRIMARY KEY);' },
    { appVersion: '0.3.6', exportedAt: '2026-08-09T00:00:00.000Z', tableCount: 1 },
  );
  const archiveB = buildWorkspaceArchive(
    { rawSql: 'CREATE TABLE workspace_b (id BIGINT PRIMARY KEY);' },
    { appVersion: '0.3.6', exportedAt: '2026-08-09T00:00:00.000Z', tableCount: 1 },
  );

  await page.locator('[data-empty-workspace]').evaluate(
    (element, archives) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([archives.a], 'workspace-a.erreview'));
      transfer.items.add(new File([archives.b], 'workspace-b.erreview'));
      element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    },
    { a: archiveA, b: archiveB },
  );

  const dialog = page.getByRole('dialog', { name: '导入' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('已选择 2 个存档')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /合并并导入/ })).toBeEnabled();
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
});
