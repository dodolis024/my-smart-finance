# 簽到提醒 Email 設定指南

本指南將協助您設定每日簽到提醒 Email 功能。

## 📋 概述

系統將使用以下技術來實現簽到提醒：

1. **Supabase Edge Function** - `send-streak-reminder`，負責檢查用戶簽到狀態並發送 Email
2. **pg_cron** - PostgreSQL 的排程擴展，每小時觸發 Edge Function
3. **Resend** - Email 發送服務（免費方案每月 3,000 封）

## 🚀 設定步驟

### 步驟 1：取得 Resend API Key（5 分鐘）

1. 前往 [Resend](https://resend.com/) 並註冊帳號
2. 登入後，前往 Dashboard → API Keys
3. 點擊 "Create API Key"
4. 複製你的 API Key（格式類似：`re_xxxxxxxxxx`）
5. **重要：** 請妥善保存這個 API Key

#### 設定發送網域（可選但建議）

免費方案可以使用 `onboarding@resend.dev` 作為寄件人，但建議設定自訂網域：

1. 在 Resend Dashboard → Domains 新增你的網域
2. 依照指示新增 DNS 記錄（SPF、DKIM）
3. 驗證完成後，更新 Edge Function 中的 `from` 欄位

### 步驟 2：設定 Supabase Secret（2 分鐘）

確保已安裝 Supabase CLI 並登入（參考 `EXCHANGE_RATE_SETUP_GUIDE.md` 步驟 2-3）。

```bash
# 設定 Resend API Key
supabase secrets set RESEND_API_KEY=re_your_api_key_here

# 驗證 secret 已設定
supabase secrets list
```

或者透過 Supabase Dashboard 設定：
1. 前往 Edge Functions → send-streak-reminder → Settings
2. 新增 Secret：`RESEND_API_KEY` = 你的 API Key

### 步驟 3：更新 Email 寄件人與連結

在部署前，請更新 `supabase/functions/send-streak-reminder/index.ts` 中的：

1. **寄件人地址** — 將 `from: 'Smart Finance <noreply@smartfinance.app>'` 改為你的網域
2. **App 連結** — 將 `https://your-app-url.com` 改為你的實際部署網址

### 步驟 4：部署 Edge Function（2 分鐘）

```bash
# 部署 Edge Function（不驗證 JWT，因為這是 cron 定時任務）
supabase functions deploy send-streak-reminder --no-verify-jwt
```

### 步驟 5：設定 pg_cron 排程（5 分鐘）

在 Supabase Dashboard → SQL Editor 中執行以下 SQL：

```sql
-- 確保已啟用必要的擴展
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- 設定每小時觸發一次的排程
SELECT cron.schedule(
  'send-streak-reminder-hourly',   -- 排程名稱
  '0 * * * *',                      -- 每小時整點觸發
  $$
  SELECT extensions.http((
    'POST',
    '<YOUR_SUPABASE_URL>/functions/v1/send-streak-reminder',
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>')
    ],
    'application/json',
    '{}'
  )::extensions.http_request) AS request_id;
  $$
);
```

⚠️ 請將 `<YOUR_SUPABASE_URL>` 和 `<YOUR_SUPABASE_ANON_KEY>` 替換為你的實際值。

## 🔧 管理排程

```sql
-- 查看排程狀態
SELECT * FROM cron.job WHERE jobname = 'send-streak-reminder-hourly';

-- 查看執行歷史
SELECT jobid, runid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobname = 'send-streak-reminder-hourly'
ORDER BY start_time DESC LIMIT 10;

-- 暫停排程
UPDATE cron.job SET active = false WHERE jobname = 'send-streak-reminder-hourly';

-- 恢復排程
UPDATE cron.job SET active = true WHERE jobname = 'send-streak-reminder-hourly';

-- 刪除排程
SELECT cron.unschedule('send-streak-reminder-hourly');
```

## 📊 運作邏輯

1. **pg_cron 每小時觸發** Edge Function
2. Edge Function 查詢所有啟用提醒的用戶
3. 根據用戶設定的**時區**與**提醒時間**，篩選「現在是提醒時刻（±30 分鐘容差）」的用戶
4. 檢查這些用戶在其**時區的今天**是否已有 checkin 記錄
5. 未簽到的用戶 → 發送提醒 Email

### 時區處理

- 用戶在前端設定自己的時區（例如 `Asia/Taipei`）
- Edge Function 根據用戶設定的時區判斷「今天」和「提醒時刻」
- 即使用戶跨時區旅行，只要不更新設定，提醒邏輯不會受影響

## 💡 注意事項

- Resend 免費方案：每月 3,000 封，每天 100 封
- 個人使用綽綽有餘
- Edge Function 每小時一次 = 每月約 720 次調用，遠低於 Supabase 免費方案的 500,000 次上限
