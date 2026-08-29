# 自動更新匯率設定指南

本指南將協助您設定每日自動更新匯率的功能。

> 對齊實作的日期：2026-08-29。prod 目前的實際狀態以 `docs/DEPLOYMENT.md` 為準，
> 本指南只描述「該怎麼建立」。兩者若有出入，以 DEPLOYMENT.md 為準。

## 📋 概述

系統將使用以下技術來實現自動更新匯率：

1. **Supabase Edge Function** - 負責呼叫外部 API 並更新資料庫
2. **pg_cron** - PostgreSQL 的排程擴展，負責每日觸發 Edge Function
3. **ExchangeRate-API** - 免費的匯率 API（每月 1,500 次請求免費）

> ⚠️ **2026-08-27 起，此 Edge Function 需要共用密鑰才能觸發**（`CRON_SECRET`，
> 與 `send-streak-reminder` 共用同一把）。排程或手動測試少了 `x-cron-secret` header
> 一律回 401，且 `cron.job_run_details` 仍會顯示 `succeeded`——不會有任何警訊。
> 驗證邏輯在 `supabase/functions/_shared/cronAuth.ts`。

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
npx supabase functions deploy update-exchange-rates --project-ref rlahfuzsxfbocmkecqvg --use-api
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
supabase functions deploy update-exchange-rates --project-ref rlahfuzsxfbocmkecqvg --use-api
```

> **`--use-api` 不可省略**：本機 Deno 打包在開發機上會失敗
> （`failed to create the graph` / `Operation not permitted`），加上此旗標改由服務端打包。

部署成功後會回傳一段 JSON（含 `"message":"Deployed Functions."`）。
確認版本有遞增：

```bash
supabase functions list --project-ref rlahfuzsxfbocmkecqvg
```

### 步驟 5：設定 Edge Function 的環境變數（2 分鐘）

有兩種方式設定：

#### 方式 A：使用 Supabase CLI（推薦）

```bash
# 設定 Exchange Rate API Key
supabase secrets set EXCHANGE_RATE_API_KEY=你的API_Key --project-ref rlahfuzsxfbocmkecqvg

# cron 專用的共用密鑰（若尚未設定過；已在用的話不要重設，會擋掉現有排程）
SECRET=$(openssl rand -hex 32); echo "$SECRET"
supabase secrets set CRON_SECRET="$SECRET" --project-ref rlahfuzsxfbocmkecqvg
```

> `CRON_SECRET` 與 `send-streak-reminder` **共用同一把**。上面把值印出來是因為
> 步驟 6 的排程要填入它；設定完就不需要再看到。
>
> ⚠️ 若此密鑰被刪除或改掉而排程沒同步更新，**匯率與提醒信會一起停擺**
> （函式 fail closed，一律回 401）。匯率突然不更新時，這裡是第一個該查的地方。

#### 方式 B：使用 Supabase Dashboard

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg)
2. 左側選單點擊 "Edge Functions"
3. 點擊 "update-exchange-rates"
4. 點擊 "Settings" 標籤
5. 在 "Secrets" 區域新增：
   - Key: `EXCHANGE_RATE_API_KEY`
   - Value: `你的_API_Key`（步驟 1 取得的）

### 步驟 6：設定 pg_cron 排程（3 分鐘）

> ⚠️ **不要使用 `scripts/setup-auto-exchange-rates.sql`**。那份是含 placeholder 的舊模板，
> 曾被原封貼上執行，導致 command 內留著 `<YOUR_SUPABASE_URL>`，匯率**靜默停擺 53 天**
> 才被發現（詳見 `docs/DEPLOYMENT.md`）。請直接用下面這段——URL 已寫死，
> 只有 key 與密鑰需要替換，且第一段防呆會擋下忘記替換的情況。

前往 [Supabase Dashboard](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg) > SQL Editor，
**先把 `<YOUR_PUBLISHABLE_KEY>` 與 `<YOUR_CRON_SECRET>` 全部取代為實際值**，再整段執行：

```sql
-- 確保已啟用必要的擴展
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- 防呆：placeholder 沒替換就中止，不讓壞掉的 job 被建立
DO $$
BEGIN
  IF '<YOUR_PUBLISHABLE_KEY>' LIKE '<YOUR\_%' OR '<YOUR_CRON_SECRET>' LIKE '<YOUR\_%' THEN
    RAISE EXCEPTION '請先將 <YOUR_PUBLISHABLE_KEY> 與 <YOUR_CRON_SECRET> 取代為實際值再執行';
  END IF;
END $$;

SELECT cron.unschedule('update-exchange-rates-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'update-exchange-rates-daily');

SELECT cron.schedule(
  'update-exchange-rates-daily',
  '0 2 * * *',  -- 每天 UTC 02:00（台灣時間 10:00）
  $$
  SELECT extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');

  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('x-cron-secret', '<YOUR_CRON_SECRET>'),
      extensions.http_header('apikey', '<YOUR_PUBLISHABLE_KEY>'),
      extensions.http_header('Authorization', 'Bearer <YOUR_PUBLISHABLE_KEY>')
    ],
    'application/json',
    '{}'
  )::extensions.http_request) AS request_id;
  $$
);
```

> **publishable key 在哪**：Dashboard > Settings > API，`sb_publishable_` 開頭。
> 它是可公開的值（前端 bundle 內就有），真正的防線是 `x-cron-secret`。

執行後**務必連 command 一起檢查**——只看 `active = true` 不足以判斷排程是否有效，
53 天那次就是這樣看起來一切正常：

```sql
SELECT
  jobname  AS "任務",
  schedule AS "排程",
  active   AS "啟用",
  CASE WHEN command LIKE '%<YOUR%'              THEN '❌ 有未替換的 placeholder' ELSE '✅ 無' END AS "placeholder",
  CASE WHEN command LIKE '%x-cron-secret%'      THEN '✅ 已帶'  ELSE '❌ 未帶' END AS "密鑰 header",
  CASE WHEN command LIKE '%CURLOPT_TIMEOUT_MS%' THEN '✅ 30 秒' ELSE '❌ 預設 5 秒' END AS "逾時"
FROM cron.job
WHERE jobname = 'update-exchange-rates-daily';
```

### 步驟 7：測試 Edge Function（2 分鐘）

在終端機執行以下命令，手動觸發一次匯率更新：

```bash
curl -X POST \
  https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates \
  -H "x-cron-secret: 你的_CRON_SECRET" \
  -H "Content-Type: application/json"
```

> **少了 `x-cron-secret` 會回 401** `{"success":false,"error":"unauthorized"}`——
> 那是預期行為，不代表函式壞了。
>
> 也可以直接在 SQL Editor 觸發（不需離開 Dashboard）：
>
> ```sql
> SELECT (r.resp).status AS "HTTP 狀態", (r.resp).content AS "回應內容"
> FROM (
>   SELECT extensions.http((
>     'POST',
>     'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
>     ARRAY[
>       extensions.http_header('Content-Type', 'application/json'),
>       extensions.http_header('x-cron-secret', '<YOUR_CRON_SECRET>')
>     ],
>     'application/json',
>     '{}'
>   )::extensions.http_request) AS resp
> ) r;
> ```

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

- **執行時間：** 每天 UTC 02:00（台灣時間早上 10:00）
- **更新的幣別：** TWD, USD, JPY, EUR, GBP, HKD, KRW

## 📊 監控與管理

### 查看 cron job 執行歷史

在 Supabase Dashboard > SQL Editor 執行（`job_run_details` 沒有 `jobname` 欄位，
必須 join `cron.job`）：

```sql
SELECT
  d.start_time AT TIME ZONE 'Asia/Taipei' AS "開始時間_台灣",
  d.status                                AS "狀態",
  d.return_message                        AS "訊息"
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
WHERE j.jobname = 'update-exchange-rates-daily'
ORDER BY d.start_time DESC
LIMIT 10;
```

> ⚠️ `succeeded` **只代表 HTTP 請求送得出去**，函式內部回 401/500 在這裡照樣顯示成功。
> 判斷匯率是否真的有更新，要看下面那個 `updated_at` 查詢。

### 查看最新匯率

```sql
SELECT
  currency_code                         AS "幣別",
  rate                                  AS "匯率",
  updated_at AT TIME ZONE 'Asia/Taipei' AS "最後更新_台灣"
FROM exchange_rates
ORDER BY currency_code;
```

> `updated_at` 應落在今天早上 10:00 前後。若停在數天前，即使 cron 顯示 `succeeded`
> 也代表更新沒真的發生（最可能是密鑰不同步，見「故障排除」）。

### 暫停 / 恢復自動更新

```sql
-- 暫停
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'update-exchange-rates-daily';

-- 恢復
SELECT cron.alter_job(jobid, active := true)  FROM cron.job WHERE jobname = 'update-exchange-rates-daily';
```

> 只改 command（例如更新密鑰）時也用 `cron.alter_job` 覆寫，**不要 unschedule + schedule 重建**——
> 重建要重新填 URL 與各種 key，正是出過事的環節。做法見
> `scripts/add-cron-secret-header.sql` 與 `scripts/fix-cron-streak-reminder-timeout.sql`。

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

時區對照表（cron 表達式為 UTC）：
- `0 16 * * *` = 台灣時間 00:00（當天午夜）
- `0 18 * * *` = 台灣時間 02:00（凌晨）
- `0 0 * * *` = 台灣時間 08:00（早上）
- `0 2 * * *` = 台灣時間 10:00（目前使用）
- `0 6 * * *` = 台灣時間 14:00（下午）

> 改排程時間請用 `cron.alter_job(jobid, schedule := '...')`，不要重建 job。

### 新增更多幣別

1. 編輯 `supabase/functions/update-exchange-rates/index.ts`，在 `currencies` 物件中新增幣別
2. 重新部署：`supabase functions deploy update-exchange-rates --project-ref rlahfuzsxfbocmkecqvg --use-api`
3. 在資料庫新增該幣別的初始資料

> ⚠️ **新增幣別時 `updated_at` 要填過去的時間**（例如 `'1970-01-01'`），不要用預設的 `NOW()`：
>
> 函式有 ±20% 的防呆，新匯率與現有值差距過大時會拒絕更新、保留舊值。若初始 rate 是隨手填的
> 概數而與真實匯率差超過 20%，該幣別會**每天被拒絕、永遠卡在錯誤的值**，而且每天都顯示執行成功。
> `updated_at` 填成過去時間可觸發「陳舊值例外」（超過 7 天未更新則跳過防呆），第一次執行就會被修正。
> 範例見 `database/supabase-migration.sql` 的 exchange_rates 種子註解。

### 更換 API 服務

如果想使用其他匯率 API（如 Fixer.io、CurrencyAPI 等），只需：

1. 修改 `supabase/functions/update-exchange-rates/index.ts` 中的 API 呼叫邏輯
2. 更新環境變數（API Key）
3. 重新部署

## 🐛 故障排除

### 匯率沒更新，但 cron 顯示 succeeded

**這是最常見也最難察覺的情況**（歷史上發生過兩次，一次停 53 天）。
`succeeded` 只代表 HTTP 請求送得出去，函式回 401/500 照樣算成功。依序檢查：

1. **command 是否完整**（placeholder / 密鑰 / 逾時）——用步驟 6 最後那段檢查查詢。
   `active = true` 不足以判斷排程有效。

2. **密鑰是否同步**：`CRON_SECRET` 被改過但排程 command 沒跟著更新，
   或反過來。手動觸發一次（步驟 7 的 SQL）看回應是不是 401。

3. **Edge Function logs**：Dashboard > Edge Functions > update-exchange-rates > Logs。
   401 會停在最前面，不會有任何幣別更新的紀錄。

4. **±20% 防呆擋下**：回應內容出現 `anomalies` 表示某幣別變動過大被拒絕、保留舊值。
   若是新增幣別後每天被擋，見「新增更多幣別」的 `updated_at` 說明。

### Edge Function 部署失敗

**錯誤：** `failed to create the graph` / `Operation not permitted`

→ 少了 `--use-api`。本機 Deno 打包在開發機上會失敗，必須改由服務端打包。

**錯誤：** `Error: Failed to deploy function`

1. 確認已登入：`supabase login`
2. 確認 `--project-ref rlahfuzsxfbocmkecqvg` 有帶上
3. 檢查網路連線後重試

### cron job 沒有執行

1. 確認 pg_cron 已啟用：
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. 確認 job 存在、為 active，**且 command 正確**：
   ```sql
   SELECT jobname, schedule, active, command FROM cron.job
   WHERE jobname = 'update-exchange-rates-daily';
   ```

3. 檢查執行記錄的錯誤訊息（需 join `cron.job`）：
   ```sql
   SELECT d.start_time AT TIME ZONE 'Asia/Taipei', d.status, d.return_message
   FROM cron.job j
   JOIN cron.job_run_details d ON d.jobid = j.jobid
   WHERE j.jobname = 'update-exchange-rates-daily'
   ORDER BY d.start_time DESC LIMIT 10;
   ```

   - `Bad hostname` → command 內有未替換的 placeholder
   - `Operation timed out after 5002 milliseconds` → command 少了 `http_set_curlopt` 那行

### 匯率 API 本身的問題

1. **API Key 錯誤或過期**：確認 `EXCHANGE_RATE_API_KEY` 已設定且仍有額度
   （回應出現 `EXCHANGE_RATE_API_KEY not configured` 表示 secret 沒設）
2. **網路問題**：Edge Function 連不到 ExchangeRate-API，查 Edge Function logs

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
