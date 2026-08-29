-- =============================================================================
-- ⛔ 已停用（2026-08-29）——請勿執行
-- =============================================================================
-- 保留此檔僅供歷史對照（docs/DEPLOYMENT.md 的執行紀錄有引用檔名）。
--
-- 不可執行的兩個理由：
-- 1. 含 <YOUR_SUPABASE_URL> placeholder。此檔曾被原封貼上執行，導致匯率靜默停擺 53 天。
-- 2. 缺少 x-cron-secret header。2026-08-27 起 Edge Function 強制驗證共用密鑰。
--
-- 只是要改排程時間的話，不要重建 job（重建就得重填 URL 與各種 key，正是出過事的環節），
-- 改用 alter_job 只覆寫 schedule：
--   SELECT cron.alter_job(jobid, schedule := '0 2 * * *')
--   FROM cron.job WHERE jobname = 'update-exchange-rates-daily';
-- 重建排程的正確做法見 docs/EXCHANGE_RATE_SETUP_GUIDE.md 步驟 6。
-- =============================================================================

-- =============================================================================
-- 更新 cron 排程時間（以下為歷史內容）
-- =============================================================================
-- 此腳本用於更新現有的 cron 排程，將執行時間改為更合適的時段
-- 執行位置：Supabase Dashboard > SQL Editor
-- 
-- ⚠️ 執行前請先替換：
-- <YOUR_SUPABASE_URL>: 你的 Supabase 專案 URL
-- <YOUR_SUPABASE_ANON_KEY>: 你的 Supabase Anon Key
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
    extensions.http((
      'POST',
      '<YOUR_SUPABASE_URL>/functions/v1/update-exchange-rates',
      ARRAY[
        extensions.http_header('Content-Type', 'application/json'),
        extensions.http_header('Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>')
      ],
      'application/json',
      '{}'
    )::extensions.http_request) AS request_id;
  $$
);

-- 驗證更新結果
-- ⚠️ 一定要看 command：只檢查 schedule/active 的話，即使 URL 還是未替換的
--    placeholder（job 每天必定 Bad hostname 失敗）也完全看不出來。
SELECT jobid, jobname, schedule, active,
       CASE WHEN command LIKE '%<YOUR%' THEN '❌ 仍有未替換的 placeholder'
            ELSE '✅ 無 placeholder' END AS placeholder_check,
       command
FROM cron.job
WHERE jobname = 'update-exchange-rates-daily';

-- 應該顯示：schedule = '0 2 * * *'，且 placeholder_check = ✅
