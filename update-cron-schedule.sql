-- =============================================================================
-- 更新 cron 排程時間
-- =============================================================================
-- 此腳本用於更新現有的 cron 排程，將執行時間改為更合適的時段
-- 執行位置：Supabase Dashboard > SQL Editor
-- =============================================================================

-- 刪除舊的排程
SELECT cron.unschedule('update-exchange-rates-daily');

-- 建立新的排程（改為 UTC 02:00，台灣時間 10:00）
-- Exchange Rate API 在 UTC 00:00 更新，我們在 02:00 執行以確保有 2 小時緩衝
SELECT cron.schedule(
  'update-exchange-rates-daily',
  '0 2 * * *',  -- 每天 UTC 02:00（台灣時間 10:00）
  $$
  SELECT
    extensions.http_post(
      url := 'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_Vc9BslZ5l-lNM0WQ8fVUmg_vbhEMqr-'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- 驗證更新結果
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname = 'update-exchange-rates-daily';

-- 應該顯示：schedule = '0 2 * * *'
