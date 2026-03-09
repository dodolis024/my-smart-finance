# 簽到提醒 Email 設定指南

本指南將協助您設定每日簽到提醒 Email 功能。

## 📋 概述

系統將使用以下技術來實現簽到提醒：

1. **Supabase Edge Function** - `send-streak-reminder`，負責檢查用戶簽到狀態並發送 Email
2. **pg_cron** - PostgreSQL 的排程擴展，每小時觸發 Edge Function
3. **Gmail SMTP** - 透過 Gmail App Password 發送提醒信（免費，無需購買網域）

## 🚀 設定步驟

### 步驟 1：取得 Gmail App Password（5 分鐘）

1. 登入你的 Google 帳號
2. 前往 [Google 帳號安全性設定](https://myaccount.google.com/security)
3. 確認已啟用**兩步驟驗證**（必須先開啟才能使用 App Password）
4. 前往 [App Password 頁面](https://myaccount.google.com/apppasswords)
5. 選擇應用程式名稱（例如輸入 `Smart Finance Reminder`）
6. 點擊「建立」，複製產生的 16 位密碼（格式類似：`xxxx xxxx xxxx xxxx`）
7. **重要：** 請妥善保存這個 App Password

### 步驟 2：設定 Supabase Secrets（2 分鐘）

確保已安裝 Supabase CLI 並登入（參考 `EXCHANGE_RATE_SETUP_GUIDE.md` 步驟 2-3）。

```bash
# 設定 Gmail 帳號
supabase secrets set GMAIL_USER=your-email@gmail.com

# 設定 Gmail App Password
supabase secrets set GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx"

# 驗證 secrets 已設定
supabase secrets list
```

或者透過 Supabase Dashboard 設定：
1. 前往 Edge Functions → send-streak-reminder → Settings
2. 新增 Secret：`GMAIL_USER` = 你的 Gmail 地址
3. 新增 Secret：`GMAIL_APP_PASSWORD` = 你的 App Password

### 步驟 3：部署 Edge Function（2 分鐘）

```bash
# 部署 Edge Function（不驗證 JWT，因為這是 cron 定時任務）
supabase functions deploy send-streak-reminder --no-verify-jwt
```

### 步驟 4：設定 pg_cron 排程（5 分鐘）

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
5. 未簽到的用戶 → 透過 Gmail SMTP 發送提醒 Email

### 時區處理

- 用戶在前端設定自己的時區（例如 `Asia/Taipei`）
- Edge Function 根據用戶設定的時區判斷「今天」和「提醒時刻」
- 即使用戶跨時區旅行，只要不更新設定，提醒邏輯不會受影響

## 💡 注意事項

- Gmail 每日發信上限：約 500 封（個人帳號），個人使用綽綽有餘
- Gmail App Password 不需要購買網域，使用個人 Gmail 帳號即可
- 收件人會看到寄件人為你的 Gmail 地址
- Edge Function 每小時一次 = 每月約 720 次調用，遠低於 Supabase 免費方案的 500,000 次上限
- 建議啟用 Google 帳號的兩步驟驗證以確保安全性
