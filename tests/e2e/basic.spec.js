/**
 * E2E 基礎測試 - 驗證頁面載入與基本結構
 *
 * 注意：主頁 index.html 需要 Supabase 登入，未登入時會導向 auth.html。
 * 此測試 focus 於 auth 頁與頁面結構驗證。
 */
import { test, expect } from '@playwright/test';

test.describe('登入頁 auth.html', () => {
  test('應正確載入登入頁', async ({ page }) => {
    await page.goto('/auth.html');
    await expect(page).toHaveTitle(/登入|Smart Finance|Smart Finance Tracker/i);
  });

  test('應顯示登入表單', async ({ page }) => {
    await page.goto('/auth.html');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /登入|登入／註冊/i })).toBeVisible();
  });

  test('應有 Google 登入按鈕', async ({ page }) => {
    await page.goto('/auth.html');
    await expect(page.getByRole('button', { name: /Google/i })).toBeVisible();
  });
});

test.describe('主頁 index.html', () => {
  test('未登入時應導向 auth 頁', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/auth\.html/, { timeout: 10000 });
    await expect(page).toHaveURL(/auth\.html/);
  });

  test('可直接存取時應顯示基本 DOM 結構', async ({ page }) => {
    // 跳過 auth 檢查，直接驗證 index 的 HTML 結構是否存在
    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    const content = await page.content();
    expect(content).toContain('Smart Finance');
    expect(content).toContain('transactionForm');
    expect(content).toContain('收支概覽');
  });
});
