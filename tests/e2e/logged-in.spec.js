/**
 * E2E 登入後功能測試
 *
 * 流程：
 * 1. 嘗試登入測試帳號，若無則註冊
 * 2. 執行核心功能測試（新增交易、檢視儀表板）
 * 3. 測試結束後執行清理腳本，刪除測試帳號及所有相關資料
 *
 * 注意：清理需要 SUPABASE_SERVICE_ROLE_KEY，請在 .env 中設定。
 * 若未設定，測試帳號會殘留在 Supabase，請至 Dashboard 手動刪除。
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const E2E_TEST_EMAIL = 'e2e-test-please-delete@example.com';
const E2E_TEST_PASSWORD = 'E2eTestPass123!';

async function ensureLoggedIn(page) {
  await page.goto('/auth.html');

  await page.getByPlaceholder('電子郵件').first().fill(E2E_TEST_EMAIL);
  await page.getByPlaceholder('密碼').first().fill(E2E_TEST_PASSWORD);
  await page.getByRole('button', { name: '登入' }).click();

  try {
    await page.waitForURL(/index\.html/, { timeout: 8000 });
    return;
  } catch {
    await page.goto('/auth.html');
  }

  await page.getByRole('button', { name: '註冊' }).click();
  await page.getByPlaceholder('電子郵件').fill(E2E_TEST_EMAIL);
  await page.getByPlaceholder('密碼（至少6個字元）').fill(E2E_TEST_PASSWORD);
  await page.getByPlaceholder('確認密碼').fill(E2E_TEST_PASSWORD);
  await page.getByRole('button', { name: '註冊' }).click();

  await page.waitForURL(/index\.html/, { timeout: 15000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('登入後功能', () => {
  test('可登入並新增一筆支出交易', async ({ page }) => {
    await ensureLoggedIn(page);

    await expect(page.locator('#transactionForm')).toBeVisible({ timeout: 10000 });

    await page.waitForSelector('#category option:not([disabled]):not([value=""])', { timeout: 10000 });
    await page.waitForSelector('#method option:not([disabled]):not([value=""])', { timeout: 10000 });

    await page.locator('#item').fill('E2E測試-午餐');
    await page.locator('#category').selectOption({ index: 1 });
    await page.locator('#method').selectOption({ index: 1 });
    await page.locator('#amount').fill('150');

    page.once('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: '新增交易' }).click();

    await expect(page.getByText(/記帳成功|已更新/)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#transactionList')).toContainText('E2E測試-午餐');
  });

  test('登入後可見收支概覽', async ({ page }) => {
    await ensureLoggedIn(page);

    await expect(page.getByText('收支概覽')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#totalIncome, #totalExpense, #balance').first()).toBeVisible();
  });
});

test.afterAll(async () => {
  const rootDir = join(__dirname, '../..');
  const child = spawn('node', [join(rootDir, 'scripts', 'cleanup-e2e-user.js')], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, E2E_TEST_EMAIL },
  });
  await new Promise((resolve) => {
    child.on('close', resolve);
  });
});
