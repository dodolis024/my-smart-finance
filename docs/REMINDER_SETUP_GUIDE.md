# 簽到提醒 Email 設定指南

本指南協助你從零設定每日簽到提醒 Email，或在需要時重建排程。

> 對齊實作的日期：2026-08-29。prod 目前的實際狀態以 `docs/DEPLOYMENT.md` 為準，
> 本指南只描述「該怎麼建立」。兩者若有出入，以 DEPLOYMENT.md 為準。

## 📋 概述

1. **Supabase Edge Function** — `send-streak-reminder`，檢查哪些用戶到了提醒時刻且今天尚未簽到，寄出提醒信
2. **pg_cron** — 每 5 分鐘觸發一次 Edge Function
3. **Brevo Transactional Email API** — 負責寄信（`BREVO_API_KEY`）

> **為什麼是每 5 分鐘**：用戶的提醒時間可以設到分鐘（例如 20:55），
> 函式以 ±2 分鐘容差判斷「現在是不是提醒時刻」（`send-streak-reminder/reminderTime.ts`），
> 每小時只跑整點會讓非整點的設定永遠收不到信。
>
> ⚠️ **排程名稱是 `send-streak-reminder-hourly`，但實際頻率是每 5 分鐘**。
> 這是歷史遺留（最初確實是每小時），改名需刪除重建排程，風險大於效益，故保留。
> 估算執行次數時請以每 5 分鐘為準（約 8,640 次/月，仍遠低於免費方案的 500,000 次）。

## 🚀 設定步驟

### 步驟 1：取得 Brevo API Key

1. 登入 [Brevo](https://www.brevo.com/) 後台
2. 右上角帳號選單 → **SMTP & API** → **API Keys**
3. 建立一把新的 API key 並複製保存

> 寄件人地址寫在程式碼內（`send-streak-reminder/index.ts` 的 `sender` 欄位），
> 要換寄件人需改該處並重新部署，且該地址需先在 Brevo 完成驗證。

### 步驟 2：設定 Supabase Secrets

```bash
# 寄信用的 Brevo API key
supabase secrets set BREVO_API_KEY=<你的 key> --project-ref rlahfuzsxfbocmkecqvg

# cron 專用的共用密鑰（若尚未設定過；已在用的話不要重設，會擋掉現有排程）
supabase secrets set CRON_SECRET=$(openssl rand -hex 32) --project-ref rlahfuzsxfbocmkecqvg

# 驗證
supabase secrets list --project-ref rlahfuzsxfbocmkecqvg
```

> `CRON_SECRET` 與 `update-exchange-rates` **共用同一把**。函式端的驗證邏輯在
> `supabase/functions/_shared/cronAuth.ts`，密鑰不符或未設定一律回 401（fail closed）。
> 用 `$(openssl rand -hex 32)` 產生時密鑰不會顯示在畫面上，但步驟 4 需要填入它——
> 需要看到值時改成先 `SECRET=$(openssl rand -hex 32); echo "$SECRET"` 再帶入。

### 步驟 3：部署 Edge Function

```bash
supabase functions deploy send-streak-reminder --project-ref rlahfuzsxfbocmkecqvg --use-api
```

> **`--use-api` 不可省略**：本機 Deno 打包在開發機上會失敗
> （`failed to create the graph` / `Operation not permitted`），加上此旗標改由服務端打包。
>
> 此函式的 `verify_jwt` 維持 `false` 是刻意的——cron 帶的 publishable key 就在前端
> bundle 內人人可得，開啟它沒有防護力。實際防線是步驟 2 的 `CRON_SECRET`。

### 步驟 4：設定 pg_cron 排程

在 Supabase Dashboard → SQL Editor 執行。**執行前把 `<YOUR_PUBLISHABLE_KEY>` 與
`<YOUR_CRON_SECRET>` 全部取代為實際值**（第一段防呆會擋下忘記取代的情況）。

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

SELECT cron.unschedule('send-streak-reminder-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-streak-reminder-hourly');

SELECT cron.schedule(
  'send-streak-reminder-hourly',   -- 名稱為歷史遺留，實際頻率見下一行
  '*/5 * * * *',                   -- 每 5 分鐘
  $$
  SELECT extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');

  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/send-streak-reminder',
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

三個容易漏掉的地方：

- **`http_set_curlopt` 必須寫在 command 內**：它是 session 層級的設定，pg_cron 每次執行都是
  獨立 session。少了這行，逾時會用預設的 5 秒，有信要寄時會被誤判為失敗
  （逐封序列寄信容易超過 5 秒）。
- **`x-cron-secret` 少了會全數被擋**：函式回 401，提醒信完全停寄，
  但 `cron.job_run_details` 仍記為 `succeeded`——不會有任何警訊。
- **URL 直接寫死**：不留 placeholder。曾有腳本的 `<YOUR_SUPABASE_URL>` 未替換就執行，
  導致匯率更新靜默停擺 53 天。

### 步驟 5：驗證

```sql
-- 5a. 排程設定（一定要看 command，只看 active 不足以判斷是否有效）
SELECT
  jobname  AS "任務",
  schedule AS "排程",
  active   AS "啟用",
  CASE WHEN command LIKE '%<YOUR%'              THEN '❌ 有未替換的 placeholder' ELSE '✅ 無' END AS "placeholder",
  CASE WHEN command LIKE '%x-cron-secret%'      THEN '✅ 已帶'  ELSE '❌ 未帶' END AS "密鑰 header",
  CASE WHEN command LIKE '%CURLOPT_TIMEOUT_MS%' THEN '✅ 30 秒' ELSE '❌ 預設 5 秒' END AS "逾時"
FROM cron.job
WHERE jobname = 'send-streak-reminder-hourly';

-- 5b. 執行歷史（等 5 分鐘後再看，應為 succeeded）
SELECT
  d.start_time AT TIME ZONE 'Asia/Taipei' AS "開始時間_台灣",
  d.status                                AS "狀態",
  d.return_message                        AS "訊息"
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
WHERE j.jobname = 'send-streak-reminder-hourly'
ORDER BY d.start_time DESC LIMIT 10;
```

> ⚠️ `succeeded` **只代表 HTTP 請求送得出去**，函式內部回 401/500 在這裡照樣顯示成功。
> 要確認函式真的通過驗證，看 Dashboard → Edge Functions → `send-streak-reminder` → Logs：
> 出現 `User <id> reminderTime=... match=...` 表示已通過密鑰檢查、進到主要邏輯。

## 🔧 管理排程

```sql
-- 查看排程狀態
SELECT * FROM cron.job WHERE jobname = 'send-streak-reminder-hourly';

-- 查看執行歷史（job_run_details 沒有 jobname 欄位，必須 join cron.job）
SELECT
  d.start_time AT TIME ZONE 'Asia/Taipei' AS "開始時間_台灣",
  d.status,
  d.return_message
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
WHERE j.jobname = 'send-streak-reminder-hourly'
ORDER BY d.start_time DESC LIMIT 10;

-- 暫停 / 恢復排程
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'send-streak-reminder-hourly';
SELECT cron.alter_job(jobid, active := true)  FROM cron.job WHERE jobname = 'send-streak-reminder-hourly';

-- 刪除排程
SELECT cron.unschedule('send-streak-reminder-hourly');
```

> 只改 command（例如更新密鑰）時用 `cron.alter_job` 覆寫，不要 unschedule + schedule 重建——
> 重建要重新填 URL 與各種 key，正是出過事的環節。範例見
> `scripts/add-cron-secret-header.sql` 與 `scripts/fix-cron-streak-reminder-timeout.sql`。

## 📊 運作邏輯

1. **pg_cron 每 5 分鐘觸發** Edge Function（帶 `x-cron-secret`）
2. 函式先驗證密鑰，不符直接回 401
3. 查詢所有**已啟用**提醒的用戶（`settings` 表 `key = 'reminder_settings'`，DB 端以 jsonb 過濾）
4. 依用戶設定的**時區**與**提醒時間**，篩出「現在是提醒時刻（±2 分鐘容差）」的用戶
5. 檢查這些用戶在其**時區的今天**是否已有 checkin 紀錄
6. 未簽到者 → 透過 Brevo API 寄信，並寫入 `reminder_last_sent` 防止重複寄送

### 時區處理

- 用戶在前端設定自己的時區（例如 `Asia/Taipei`、`Europe/London`）
- 函式依該時區判斷「今天」與「提醒時刻」
- 跨時區旅行時只要不改設定，提醒邏輯不受影響

### 為什麼容差是 ±2 分鐘

cron 每 5 分鐘跑一次、用戶設定的最小單位也是 5 分鐘，±2 分鐘保證每個提醒時刻
**只會被一次 cron 命中**，不會重複觸發。改動 cron 頻率時必須連容差一起重新評估
（`reminderTime.ts`），否則會出現漏寄或重複寄。

## 💡 注意事項

- 寄信量受 Brevo 方案的每日額度限制，實際上限以 Brevo 後台為準
- 收件人看到的寄件人地址寫在 `index.ts` 內，更換需重新部署且該地址須經 Brevo 驗證
- 每 5 分鐘一次 ≈ 8,640 次/月，遠低於 Supabase 免費方案的 500,000 次
- 目前是**逐封序列寄信**；收件者大幅增加後單次執行可能超過 30 秒逾時，
  屆時需改為平行寄送（`index.ts` 的寄信迴圈）
