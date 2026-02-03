# 自動更新匯率設定指南

本指南將協助您設定每日自動更新匯率的功能。

## 📋 概述

系統將使用以下技術來實現自動更新匯率：

1. **Supabase Edge Function** - 負責呼叫外部 API 並更新資料庫
2. **pg_cron** - PostgreSQL 的排程擴展，負責每日觸發 Edge Function
3. **ExchangeRate-API** - 免費的匯率 API（每月 1,500 次請求免費）

## 🚀 設定步驟

### 步驟 1：取得 Exchange Rate API Key（5 分鐘）

1. 前往 [ExchangeRate-API](https://www.exchangerate-api.com/)
2. 點擊右上角 "Get Free Key" 或 "Sign Up"
3. 填寫電子郵件註冊（免費方案，每月 1,500 次請求）
4. 註冊完成後，複製你的 API Key（格式類似：`1234567890abcdef12345678`）
5. **重要：** 請妥善保存這個 API Key

### 步驟 2：安裝 Supabase CLI（5 分鐘）

如果您已經安裝過 Supabase CLI，可以跳過此步驟。

#### macOS（推薦使用 Homebrew）

```bash
brew install supabase/tap/supabase
```

#### Windows

```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

#### Linux

```bash
# 使用官方安裝腳本
curl -fsSL https://supabase.com/install.sh | sh
```

#### 或使用 npx（無需安裝，所有平台）

如果不想安裝 CLI，可以使用 `npx` 直接執行命令：

```bash
# 之後所有的 supabase 命令都改用 npx supabase
npx supabase login
npx supabase link --project-ref rlahfuzsxfbocmkecqvg
npx supabase functions deploy update-exchange-rates
```

> **注意：** npm install -g supabase 已不再支援，請使用上述方法之一。

#### 驗證安裝

```bash
supabase --version
# 或使用 npx
npx supabase --version
```

### 步驟 3：登入並連結專案（3 分鐘）

```bash
# 登入 Supabase
supabase login

# 連結到你的專案（會開啟瀏覽器進行授權）
supabase link --project-ref rlahfuzsxfbocmkecqvg
```

> **提示：** 如果不確定你的 project-ref，可以在 Supabase Dashboard 的 URL 中找到：
> `https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg`（這個就是你的 project-ref）

### 步驟 4：部署 Edge Function（2 分鐘）

在終端機中，切換到專案目錄並執行：

```bash
cd /Users/doris/Documents/my-smart-finance

# 部署 Edge Function
supabase functions deploy update-exchange-rates
```

部署成功後，你會看到類似以下訊息：

```
Deploying update-exchange-rates (project ref: rlahfuzsxfbocmkecqvg)
✓ Function deployed successfully!
Function URL: https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates
```

### 步驟 5：設定 Edge Function 的環境變數（2 分鐘）

有兩種方式設定：

#### 方式 A：使用 Supabase CLI（推薦）

```bash
# 設定 Exchange Rate API Key
supabase secrets set EXCHANGE_RATE_API_KEY=你的API_Key
```

#### 方式 B：使用 Supabase Dashboard

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg)
2. 左側選單點擊 "Edge Functions"
3. 點擊 "update-exchange-rates"
4. 點擊 "Settings" 標籤
5. 在 "Secrets" 區域新增：
   - Key: `EXCHANGE_RATE_API_KEY`
   - Value: `你的_API_Key`（步驟 1 取得的）

### 步驟 6：設定 pg_cron 排程（3 分鐘）

1. 開啟 `setup-auto-exchange-rates.sql` 檔案
2. 找到以下兩個地方，並替換為你的實際值：

   ```sql
   url := '<YOUR_SUPABASE_URL>/functions/v1/update-exchange-rates',
   ```
   替換為：
   ```sql
   url := 'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
   ```

   ```sql
   'Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>'
   ```
   替換為：
   ```sql
   'Authorization', 'Bearer 你的_Anon_Key'
   ```

   > **如何找到 Anon Key：**
   > 1. 前往 Supabase Dashboard > Settings > API
   > 2. 複製 "Project API keys" 中的 "anon" "public" key

3. 前往 [Supabase Dashboard](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg) > SQL Editor
4. 將修改後的 `setup-auto-exchange-rates.sql` 內容貼上
5. 點擊右下角的 "Run" 按鈕執行

如果成功，你會看到類似以下輸出：

| jobid | jobname | schedule | active | command |
|-------|---------|----------|--------|---------|
| 1 | update-exchange-rates-daily | 0 18 * * * | true | SELECT extensions.http_post(...) |

### 步驟 7：測試 Edge Function（2 分鐘）

在終端機執行以下命令，手動觸發一次匯率更新：

```bash
curl -X POST \
  https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates \
  -H "Authorization: Bearer 你的_Anon_Key" \
  -H "Content-Type: application/json"
```

如果成功，你會看到類似以下回應：

```json
{
  "success": true,
  "message": "Exchange rates updated successfully",
  "timestamp": "2026-02-03T10:30:45.123Z",
  "updates": [
    { "currency": "TWD", "success": true, "rate": 1 },
    { "currency": "USD", "success": true, "rate": 31.25 },
    { "currency": "JPY", "success": true, "rate": 0.208 },
    { "currency": "EUR", "success": true, "rate": 33.85 },
    { "currency": "GBP", "success": true, "rate": 39.42 }
  ]
}
```

### 步驟 8：驗證匯率已更新（1 分鐘）

1. 前往 Supabase Dashboard > Table Editor
2. 選擇 `exchange_rates` 表
3. 檢查 `updated_at` 欄位是否為剛才執行的時間
4. 檢查 `rate` 欄位是否為最新的匯率

## ✅ 完成！

現在您的系統會每天自動更新匯率！

- **執行時間：** 每天台灣時間凌晨 2:00（UTC 18:00）
- **更新的幣別：** TWD, USD, JPY, EUR, GBP

## 📊 監控與管理

### 查看 cron job 執行歷史

在 Supabase Dashboard > SQL Editor 執行：

```sql
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details 
WHERE jobname = 'update-exchange-rates-daily'
ORDER BY start_time DESC 
LIMIT 10;
```

### 查看最新匯率

```sql
SELECT currency_code, rate, updated_at 
FROM exchange_rates 
ORDER BY updated_at DESC;
```

### 暫停自動更新

```sql
UPDATE cron.job 
SET active = false 
WHERE jobname = 'update-exchange-rates-daily';
```

### 恢復自動更新

```sql
UPDATE cron.job 
SET active = true 
WHERE jobname = 'update-exchange-rates-daily';
```

### 刪除自動更新

```sql
SELECT cron.unschedule('update-exchange-rates-daily');
```

## 🔧 進階設定

### 修改執行時間

如果想改為每天早上 8:00（台灣時間）執行，修改 cron 表達式為：

```sql
'0 0 * * *'  -- UTC 00:00 = 台灣時間 08:00
```

時區對照表：
- `0 16 * * *` = 台灣時間 00:00（當天午夜）
- `0 18 * * *` = 台灣時間 02:00（凌晨）
- `0 0 * * *` = 台灣時間 08:00（早上）
- `0 6 * * *` = 台灣時間 14:00（下午）

### 新增更多幣別

1. 編輯 `supabase/functions/update-exchange-rates/index.ts`
2. 在 `currencies` 物件中新增幣別（例如 CNY、KRW）
3. 重新部署：`supabase functions deploy update-exchange-rates`
4. 在資料庫中手動新增該幣別的初始資料

### 更換 API 服務

如果想使用其他匯率 API（如 Fixer.io、CurrencyAPI 等），只需：

1. 修改 `supabase/functions/update-exchange-rates/index.ts` 中的 API 呼叫邏輯
2. 更新環境變數（API Key）
3. 重新部署

## 🐛 故障排除

### Edge Function 部署失敗

**錯誤：** `Error: Failed to deploy function`

**解決方法：**
1. 確認已登入：`supabase login`
2. 確認已連結專案：`supabase link --project-ref rlahfuzsxfbocmkecqvg`
3. 檢查網路連線
4. 重試部署

### cron job 沒有執行

**檢查步驟：**

1. 確認 pg_cron 已啟用：
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. 確認 job 存在且為 active：
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'update-exchange-rates-daily';
   ```

3. 檢查執行記錄的錯誤訊息：
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobname = 'update-exchange-rates-daily'
   ORDER BY start_time DESC;
   ```

### 匯率更新失敗

**可能原因：**

1. **API Key 錯誤或過期**
   - 檢查環境變數是否正確設定
   - 確認 API key 仍有效且有剩餘額度

2. **網路問題**
   - Edge Function 無法連接到 ExchangeRate-API
   - 檢查 Edge Function logs

3. **權限問題**
   - 確認 Edge Function 使用的是 service role key（自動處理）

**檢查 logs：**
1. Supabase Dashboard > Edge Functions > update-exchange-rates > Logs
2. 查看最近的執行記錄和錯誤訊息

## 📞 需要協助？

如有問題，請參考：
- [Supabase Edge Functions 文件](https://supabase.com/docs/guides/functions)
- [pg_cron 文件](https://github.com/citusdata/pg_cron)
- [ExchangeRate-API 文件](https://www.exchangerate-api.com/docs)

---

**設定完成！** 🎉 您的匯率現在會每天自動更新了！
