-- =============================================================================
-- 訂閱自動入帳改排在匯率更新之後
-- 在 Supabase SQL Editor 手動執行（2026-10-20 建立）
-- =============================================================================
--
-- 背景：process-subscriptions-daily 排在 01:00 UTC（台灣 09:00），update-exchange-rates-daily
-- 排在 02:00 UTC（台灣 10:00）。順序反了：外幣訂閱每天都用「昨天」的匯率入帳，而同一天
-- 10:00 之後手動記的帳用的是「今天」的。差距只有一天的匯率變動，但同一天兩種匯率並存。
--
-- 做法：只改 schedule，不動 command（command 內含 anon key 與 cron 密鑰，重建風險高），
-- 改到 02:30 UTC（台灣 10:30），給匯率函式半小時餘裕。
-- 影響：訂閱入帳的 time 欄位會從 09:00 變成 10:30（台灣），其他不變。
-- credit-card-reminder-daily 維持 01:00 UTC，它不用匯率。

-- 1. 執行前狀態
SELECT jobname AS "任務", schedule AS "目前排程", active
FROM cron.job
WHERE jobname IN ('process-subscriptions-daily', 'update-exchange-rates-daily');

-- 2. 套用
DO $do$
DECLARE
  v_jobid    bigint;
  v_schedule text;
BEGIN
  SELECT jobid, schedule INTO v_jobid, v_schedule
  FROM cron.job
  WHERE jobname = 'process-subscriptions-daily';

  IF v_jobid IS NULL THEN
    RAISE EXCEPTION '找不到 job process-subscriptions-daily';
  END IF;

  IF v_schedule = '30 2 * * *' THEN
    RAISE NOTICE '已經是 30 2 * * *，略過';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id := v_jobid, schedule := '30 2 * * *');
  RAISE NOTICE '已將 process-subscriptions-daily 從 % 改為 30 2 * * *（台灣 10:30，在匯率更新之後）', v_schedule;
END $do$;

-- 3. 驗證（單一 SELECT）：訂閱應為 30 2 * * *、匯率仍為 0 2 * * *，ordered_after_rates 為 true
SELECT
  (SELECT schedule FROM cron.job WHERE jobname = 'process-subscriptions-daily') AS subscriptions_schedule,
  (SELECT schedule FROM cron.job WHERE jobname = 'update-exchange-rates-daily') AS rates_schedule,
  (SELECT schedule FROM cron.job WHERE jobname = 'process-subscriptions-daily') = '30 2 * * *'
    AND (SELECT schedule FROM cron.job WHERE jobname = 'update-exchange-rates-daily') = '0 2 * * *'
    AS ordered_after_rates;
