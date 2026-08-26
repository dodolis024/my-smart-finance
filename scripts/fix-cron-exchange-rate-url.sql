-- =============================================================================
-- 修復 update-exchange-rates-daily 的 placeholder URL
-- =============================================================================
-- 症狀：cron.job_run_details 連續數十天 status='failed'，
--       return_message = 'ERROR:  URL rejected: Bad hostname'
--
-- 原因：setup-auto-exchange-rates.sql / update-cron-schedule.sql 是含
--       <YOUR_SUPABASE_URL> 與 <YOUR_SUPABASE_ANON_KEY> 的模板，曾被原封貼上執行，
--       job 的 command 就留著 placeholder。pg_cron 每天照跑，但 http() 連不到
--       名為 <YOUR_SUPABASE_URL> 的主機，請求從未離開資料庫。
--       兩個模板的驗證查詢都只看 jobid/jobname/schedule/active，不看 command，
--       所以壞掉時看起來一切正常。
--
-- ⚠️ 執行前：把 <YOUR_PUBLISHABLE_KEY> 全部取代為專案的 publishable key
--    （Dashboard > Settings > API，sb_publishable_ 開頭；與 cron job
--     send-streak-reminder-hourly / process-subscriptions-daily 用的是同一把）
--
-- 執行位置：Supabase Dashboard > SQL Editor（整份貼上執行）
-- =============================================================================

-- 1. 防呆：key 沒替換就中止，不讓壞掉的 job 再被建立一次
--    （用編輯器的「全部取代」換掉 placeholder 時，這個條件會一併變成 false）
DO $$
BEGIN
  IF '<YOUR_PUBLISHABLE_KEY>' LIKE '<YOUR\_%' THEN
    RAISE EXCEPTION '請先將腳本中的 <YOUR_PUBLISHABLE_KEY> 全部取代為實際的 key 再執行';
  END IF;
END $$;

-- 2. 重建排程（URL 直接寫死，不再留 placeholder）
SELECT cron.unschedule('update-exchange-rates-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'update-exchange-rates-daily');

SELECT cron.schedule(
  'update-exchange-rates-daily',
  '0 2 * * *',  -- 每天 UTC 02:00（台灣時間 10:00）
  $$
  SELECT
    extensions.http((
      'POST',
      'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
      ARRAY[
        extensions.http_header('Content-Type', 'application/json'),
        extensions.http_header('apikey', '<YOUR_PUBLISHABLE_KEY>'),
        extensions.http_header('Authorization', 'Bearer <YOUR_PUBLISHABLE_KEY>')
      ],
      'application/json',
      '{}'
    )::extensions.http_request) AS request_id;
  $$
);

-- 3. 驗證：一定要看 command，這是當初漏掉的那一步
SELECT
  jobname   AS "任務",
  schedule  AS "排程",
  active    AS "啟用",
  CASE WHEN command LIKE '%<YOUR%' THEN '❌ 仍有未替換的 placeholder'
       ELSE '✅ 無 placeholder' END AS "檢查",
  command   AS "指令"
FROM cron.job
WHERE jobname = 'update-exchange-rates-daily';

-- =============================================================================
-- 4. 立即手動觸發一次，不必等到明天 UTC 02:00
-- =============================================================================
-- 直接看得到 Edge Function 的回應，可一併確認 EXCHANGE_RATE_API_KEY 是否有效。
-- 預期 status=200 且 body 內含 "success": true 與各幣別的 updates。
-- 若 body 出現 "EXCHANGE_RATE_API_KEY not configured"，表示 Edge Function 的
-- secret 沒設；若出現 anomalies，表示有幣別變動超過 ±20% 被防呆擋下（保留舊值）。
SELECT
  (r.resp).status  AS "HTTP 狀態",
  (r.resp).content AS "回應內容"
FROM (
  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('apikey', '<YOUR_PUBLISHABLE_KEY>'),
      extensions.http_header('Authorization', 'Bearer <YOUR_PUBLISHABLE_KEY>')
    ],
    'application/json',
    '{}'
  )::extensions.http_request) AS resp
) r;

-- =============================================================================
-- 5. 觸發後確認匯率真的被寫入（updated_at 應為剛剛，且不再是整數種子值）
-- =============================================================================
SELECT
  currency_code                          AS "幣別",
  rate                                   AS "匯率",
  updated_at AT TIME ZONE 'Asia/Taipei'  AS "最後更新_台灣"
FROM exchange_rates
ORDER BY currency_code;
