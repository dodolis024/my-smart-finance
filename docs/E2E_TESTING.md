# E2E 測試說明

## 安裝

首次使用前請先安裝 Playwright 瀏覽器：

```bash
npx playwright install chromium
```

## 執行方式

### 僅執行不需登入的基礎測試（不寫入 Supabase）

```bash
npm run test:e2e:basic
```

### 執行完整 E2E 測試（含登入與功能測試）

```bash
npm run test:e2e
```

完整測試會：

1. **註冊專用測試帳號**：`e2e-test-please-delete@example.com`
2. **執行功能測試**：新增交易、檢視儀表板
3. **自動清理**：測試結束後刪除測試帳號及所有相關資料

## 自動清理設定

要讓測試結束後自動刪除測試帳號，需設定 Supabase Service Role Key：

1. 複製 `.env.example` 為 `.env`
2. 在 `.env` 中加入：
   ```
   SUPABASE_URL=https://你的專案.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=你的_service_role_key
   ```
3. Service Role Key 可在 Supabase Dashboard > Settings > API 找到
4. **請勿將 `.env` 提交至 Git**

若未設定，測試仍會執行，但測試帳號會殘留。可至 Supabase Dashboard > Authentication > Users 手動刪除 `e2e-test-please-delete@example.com`。

## 手動清理

若測試中斷或未設定自動清理，可手動執行：

```bash
E2E_TEST_EMAIL=e2e-test-please-delete@example.com npm run cleanup:e2e
```

## 注意事項

- 若 Supabase 已啟用「信箱驗證」，新註冊用戶需點擊驗證信才能登入。E2E 測試會失敗，請在 Dashboard > Authentication > Providers > Email 中暫時關閉「Confirm email」。
- 測試會使用你專案中的 Supabase 設定，請確保使用測試環境或可接受測試資料（測試後會清理）。
