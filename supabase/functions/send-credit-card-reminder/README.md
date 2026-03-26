# send-credit-card-reminder

Supabase Edge Function — 信用卡繳款日提醒推播

## 功能

每日定時執行，檢查所有用戶的信用卡帳戶，對符合條件的帳戶發送 Web Push 推播通知：

- **繳款日前 N 天**（N = 用戶設定的 `payment_days_before`，預設 3 天）
- **繳款日當天**

設定為用戶層級：同一帳號下的所有信用卡共用相同設定。

## 觸發條件

- `credit_card_notification_settings.payment_reminder_enabled === true`
- 距繳款日天數等於 `payment_days_before` 或 0（當天）

## 防重複機制

`settings` 表中以 `key = 'credit_card_reminder_last_sent'` 記錄各帳戶當日是否已發送，格式：

```json
{
  "<account_id>_before": "2026-03-22",
  "<account_id>_due": "2026-03-25"
}
```

## 設定 pg_cron 排程

在 Supabase Dashboard > SQL Editor 執行以下 SQL：

```sql
-- 每天台灣時間早上 9:00 執行（UTC 01:00）
SELECT cron.schedule(
  'credit-card-reminder-daily',
  '0 1 * * *',
  $$
  SELECT
    net.http_post(
      url := '<YOUR_SUPABASE_URL>/functions/v1/send-credit-card-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

**重要：** 請將 `<YOUR_SUPABASE_URL>` 和 `<YOUR_SUPABASE_ANON_KEY>` 替換為實際值。

## 手動測試

```bash
curl -X POST \
  https://<your-project-ref>.supabase.co/functions/v1/send-credit-card-reminder \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## 環境變數（與其他推播 Function 共用）

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `SUPABASE_URL`（自動注入）
- `SUPABASE_SERVICE_ROLE_KEY`（自動注入）
