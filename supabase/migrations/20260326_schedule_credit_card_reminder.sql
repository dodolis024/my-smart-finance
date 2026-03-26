-- 設定信用卡繳款日提醒的每日排程
-- 每天台灣時間 09:00（UTC 01:00）執行
-- 執行前請確認 pg_cron 與 pg_net 擴充已啟用

SELECT cron.schedule(
  'credit-card-reminder-daily',
  '0 1 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/send-credit-card-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_wjxnEBkzCyZff_0ldN2_ag_jwyUaeF5'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
