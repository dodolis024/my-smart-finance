# send-credit-card-reminder

Supabase Edge Function — 信用卡繳款日提醒推播

## 功能

每日定時執行，檢查所有用戶的信用卡帳戶，對符合條件的帳戶發送 Web Push 推播通知：

- **繳款日前 N 天**（N = 用戶設定的 `payment_days_before`，預設 3 天）
- **繳款日當天**

設定為用戶層級：同一帳號下的所有信用卡共用相同設定。

## 觸發條件

- `credit_card_notification_settings.payment_reminder_enabled === true`
  （未設定過的用戶視同未啟用，與前端預設 `false` 一致）
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

排程名稱 `credit-card-reminder-daily`，每天台灣時間 09:00（UTC 01:00）執行。

建立方式見 `scripts/fix-cron-auth-and-credit-card-schedule.sql`，在 Supabase
Dashboard > SQL Editor 整份執行即可——該腳本會從既有排程複製網址與金鑰，
不必手動填任何 placeholder。

> 這支函式 2026-03 上線後，這個排程一直沒有被建立，直到 2026-08-31 才補上，
> 期間從未發送過任何提醒。新增同類函式時記得確認排程真的存在
> （`SELECT * FROM cron.job`），光是部署函式不會讓它跑起來。

## 存取限制

本函式只接受帶正確 `x-cron-secret` header 的請求（見 `_shared/cronAuth.ts`），
其餘一律回 401。密鑰存放於 Supabase secrets 的 `CRON_SECRET`。

## 手動測試

會真的推播給符合條件的使用者，請斟酌執行。密鑰不要寫進檔案或貼進對話。

```bash
curl -X POST \
  https://<your-project-ref>.supabase.co/functions/v1/send-credit-card-reminder \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## 環境變數（與其他推播 Function 共用）

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `SUPABASE_URL`（自動注入）
- `SUPABASE_SERVICE_ROLE_KEY`（自動注入）
