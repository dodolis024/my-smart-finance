-- =============================================================================
-- 放寬 send-streak-reminder-hourly 的 HTTP 逾時（5 秒 → 30 秒）
-- =============================================================================
-- 症狀：cron.job_run_details 每天出現數筆 status='failed'，
--       return_message = 'ERROR:  Operation timed out after 5002 milliseconds
--       with 0 bytes received'。近 14 天 4032 次觸發中 34 次失敗。
--
-- 判定：誤報。5002ms 是 http extension 的預設逾時（CURLOPT_TIMEOUT_MS = 5000）。
--       send-streak-reminder 是逐封序列寄信（index.ts:204-240，每位收件者都
--       await Brevo API 再 await 寫 reminder_last_sent），有信要寄時容易超過 5 秒。
--       資料庫只是「不等了」，Edge Function 仍在雲端跑完——已驗證 2026-08-26
--       台北 21:50 那班 cron 記為 failed，但信照樣寄出、reminder_last_sent 有寫入。
--
-- 為何仍要修：天天出現 failed 會讓 cron.job_run_details 失去可信度，真的壞掉時
--             分辨不出來（匯率停擺 53 天沒被發現就是同一種土壤）。
--
-- 做法：在 cron command 最前面加一行放寬逾時。http_set_curlopt 是 session 層級，
--       pg_cron 每次執行都是獨立 session，所以必須寫進 command 內才有效。
--       這裡用 cron.alter_job 只覆寫 command（在既有 command 前面接上那一行），
--       不重建 job——既有的 URL 與 key 原封不動，不會有 placeholder 風險。
--
-- 執行位置：Supabase Dashboard > SQL Editor（整份貼上執行）
-- 可重複執行：已套用過會直接跳過。
-- =============================================================================

-- 1. 執行前的現況（command 內含 key，確認開頭即可，不必外流全文）
SELECT
  jobname   AS "任務",
  schedule  AS "排程",
  active    AS "啟用",
  CASE WHEN command LIKE '%CURLOPT_TIMEOUT_MS%' THEN '已放寬' ELSE '預設 5 秒' END AS "逾時設定",
  left(command, 80) AS "command 開頭"
FROM cron.job
WHERE jobname = 'send-streak-reminder-hourly';

-- 2. 套用
DO $do$
DECLARE
  v_jobid   bigint;
  v_command text;
  v_prefix  text := $q$SELECT extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');$q$;
BEGIN
  SELECT jobid, command INTO v_jobid, v_command
  FROM cron.job
  WHERE jobname = 'send-streak-reminder-hourly';

  IF v_jobid IS NULL THEN
    RAISE EXCEPTION '找不到 job send-streak-reminder-hourly';
  END IF;

  -- 防呆：既有 command 若殘留模板 placeholder，先修那個，不要在壞的 command 上疊加
  IF v_command LIKE '%<YOUR%' THEN
    RAISE EXCEPTION 'command 內仍有未替換的 placeholder，請先修正 URL/key 再執行本腳本';
  END IF;

  IF v_command LIKE '%CURLOPT_TIMEOUT_MS%' THEN
    RAISE NOTICE '逾時已設定過，略過';
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    job_id  := v_jobid,
    command := v_prefix || E'\n' || v_command
  );

  RAISE NOTICE '已將 send-streak-reminder-hourly 的 HTTP 逾時放寬為 30 秒';
END $do$;

-- 3. 驗證：逾時設定應變成「已放寬」，且 command 開頭是 http_set_curlopt
SELECT
  jobname   AS "任務",
  schedule  AS "排程",
  active    AS "啟用",
  CASE WHEN command LIKE '%CURLOPT_TIMEOUT_MS%' THEN '✅ 已放寬 30 秒' ELSE '❌ 仍為預設 5 秒' END AS "逾時設定",
  CASE WHEN command LIKE '%<YOUR%' THEN '❌ 仍有未替換的 placeholder' ELSE '✅ 無 placeholder' END AS "placeholder",
  left(command, 80) AS "command 開頭"
FROM cron.job
WHERE jobname = 'send-streak-reminder-hourly';

-- =============================================================================
-- 4. 觀察（套用後隔天再看）
-- =============================================================================
-- 預期：failed 歸零。仍有 failed 表示不是寄信慢，而是別的問題（值得查）。
-- 注意：succeeded 只代表 HTTP 請求送得出去，Edge Function 內部回 401/500
--       在這裡照樣顯示成功。
SELECT
  d.status                                  AS "狀態",
  count(*)                                  AS "次數",
  min(d.start_time AT TIME ZONE 'Asia/Taipei') AS "最早_台灣",
  max(d.start_time AT TIME ZONE 'Asia/Taipei') AS "最晚_台灣"
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
WHERE j.jobname = 'send-streak-reminder-hourly'
  AND d.start_time > now() - interval '24 hours'
GROUP BY d.status;

-- 失敗明細（若上一段仍有 failed）
SELECT
  d.start_time AT TIME ZONE 'Asia/Taipei' AS "開始時間_台灣",
  d.return_message                        AS "訊息"
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
WHERE j.jobname = 'send-streak-reminder-hourly'
  AND d.status = 'failed'
ORDER BY d.start_time DESC
LIMIT 20;

-- =============================================================================
-- 備註：同樣的逾時放寬也適用於其他用 extensions.http() 的 job
--       （process-subscriptions-daily、update-exchange-rates-daily）。
--       目前那兩支未觀察到逾時失敗，先不動；若日後出現同樣的 5002ms 訊息，
--       把上面 DO block 內的 jobname 換掉再跑一次即可。
-- =============================================================================
