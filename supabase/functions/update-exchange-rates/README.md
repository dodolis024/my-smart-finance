# Update Exchange Rates Edge Function

這個 Edge Function 負責每日自動更新匯率表（`exchange_rates`）。

## 功能

- 從 [ExchangeRate-API](https://www.exchangerate-api.com/) 取得最新匯率
- 自動更新資料庫中的 TWD、USD、JPY、EUR、GBP 匯率
- 可透過 pg_cron 設定為每日自動執行

## 設定步驟

### 1. 取得 Exchange Rate API Key

1. 前往 https://www.exchangerate-api.com/
2. 註冊免費帳號（每月 1,500 次請求免費）
3. 複製你的 API Key：10354d97d0727ec2e2cd92cf

### 2. 部署 Edge Function

在終端機執行：

```bash
# 安裝 Supabase CLI（如果還沒安裝）
# macOS/Linux:
brew install supabase/tap/supabase

# 或使用 npx（不需要全域安裝）:
# npx supabase [command]

# 登入 Supabase
supabase login

# 連結到你的專案
supabase link --project-ref <your-project-id>

# 部署 Edge Function
supabase functions deploy update-exchange-rates
```

### 3. 設定環境變數

在 Supabase Dashboard > Edge Functions > update-exchange-rates > Settings 中設定：

- `EXCHANGE_RATE_API_KEY`: 你的 ExchangeRate-API 金鑰

### 4. 設定 pg_cron 排程

在 Supabase Dashboard > SQL Editor 執行以下 SQL：

```sql
-- 啟用 pg_cron 擴展
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 設定每日凌晨 2 點（台灣時間）更新匯率
-- 注意：Supabase 使用 UTC 時間，所以台灣時間 02:00 = UTC 18:00（前一天）
SELECT cron.schedule(
  'update-exchange-rates-daily',
  '0 18 * * *',  -- 每天 UTC 18:00（台灣時間隔天 02:00）
  $$
  SELECT
    net.http_post(
      url := '<YOUR_SUPABASE_URL>/functions/v1/update-exchange-rates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

**重要：** 請將 `<YOUR_SUPABASE_URL>` 和 `<YOUR_SUPABASE_ANON_KEY>` 替換為你的實際值。

### 5. 手動測試

你可以使用 curl 或在瀏覽器中直接測試：

```bash
curl -X POST \
  https://<your-project-ref>.supabase.co/functions/v1/update-exchange-rates \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json"
```

## 監控

### 檢查 cron job 狀態

```sql
SELECT * FROM cron.job;
```

### 檢查執行歷史

```sql
SELECT * FROM cron.job_run_details 
WHERE jobname = 'update-exchange-rates-daily'
ORDER BY start_time DESC 
LIMIT 10;
```

### 檢查最新匯率

```sql
SELECT currency_code, rate, updated_at 
FROM exchange_rates 
ORDER BY updated_at DESC;
```

## 新增更多幣別

如果要新增更多幣別（例如 CNY、KRW），只需：

1. 在 `index.ts` 的 `currencies` 物件中新增幣別
2. 在 `exchange_rates` 表中手動新增該幣別的初始資料
3. 重新部署 Edge Function

## 故障排除

### Edge Function 執行失敗

- 檢查 Edge Function logs：Supabase Dashboard > Edge Functions > update-exchange-rates > Logs
- 確認 `EXCHANGE_RATE_API_KEY` 已正確設定
- 確認 API key 尚未過期且有剩餘額度

### cron job 沒有執行

- 檢查 pg_cron 是否已啟用：`SELECT * FROM pg_extension WHERE extname = 'pg_cron';`
- 檢查 job 是否存在：`SELECT * FROM cron.job;`
- 檢查執行記錄：`SELECT * FROM cron.job_run_details ORDER BY start_time DESC;`

### 匯率沒有更新

- 手動執行 Edge Function 測試
- 檢查 RLS 政策是否允許更新（Edge Function 使用 service role key，應該有完整權限）
- 檢查資料庫表是否存在：`SELECT * FROM exchange_rates;`
