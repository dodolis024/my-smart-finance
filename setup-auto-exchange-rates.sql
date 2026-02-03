-- =============================================================================
-- 自動更新匯率設定 SQL
-- =============================================================================
-- 此腳本用於設定 pg_cron 排程，讓匯率每日自動更新
-- 執行位置：Supabase Dashboard > SQL Editor
-- 
-- 前置條件：
-- 1. 已部署 update-exchange-rates Edge Function
-- 2. 已在 Edge Function 設定中配置 EXCHANGE_RATE_API_KEY
-- 
-- 執行此腳本前，請先將以下兩個值替換為你的實際值：
-- ✅ 已自動填入您的 Supabase URL 和 Anon Key
-- =============================================================================

-- 1. 啟用 pg_cron 擴展（如果尚未啟用）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. 啟用 http 擴展（用於從資料庫發送 HTTP 請求）
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- 3. 刪除舊的排程（如果存在）
SELECT cron.unschedule('update-exchange-rates-daily') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'update-exchange-rates-daily'
);

-- 4. 建立新的每日排程
-- 時間設定：每天 UTC 02:00 執行（相當於台灣時間 10:00）
-- Exchange Rate API 在 UTC 00:00 更新，我們在 02:00 執行以確保有 2 小時緩衝
SELECT cron.schedule(
  'update-exchange-rates-daily',        -- job 名稱
  '0 2 * * *',                          -- cron 表達式：每天 UTC 02:00（台灣時間 10:00）
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

-- =============================================================================
-- 完成！排程已設定
-- =============================================================================

-- 驗證排程是否建立成功
SELECT jobid, jobname, schedule, active, command 
FROM cron.job 
WHERE jobname = 'update-exchange-rates-daily';

-- 提示：首次執行會在明天的排程時間自動執行
-- 如果想立即測試，請直接呼叫 Edge Function：
-- curl -X POST https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates \
--   -H "Authorization: Bearer sb_publishable_Vc9BslZ5l-lNM0WQ8fVUmg_vbhEMqr-" \
--   -H "Content-Type: application/json"

-- =============================================================================
-- 常用管理指令
-- =============================================================================

-- 查看所有 cron jobs
-- SELECT * FROM cron.job;

-- 查看 cron job 執行歷史（最近 10 筆）
-- SELECT jobid, runid, job_pid, status, return_message, start_time, end_time
-- FROM cron.job_run_details 
-- WHERE jobname = 'update-exchange-rates-daily'
-- ORDER BY start_time DESC 
-- LIMIT 10;

-- 手動停用排程（不刪除）
-- UPDATE cron.job SET active = false WHERE jobname = 'update-exchange-rates-daily';

-- 重新啟用排程
-- UPDATE cron.job SET active = true WHERE jobname = 'update-exchange-rates-daily';

-- 刪除排程
-- SELECT cron.unschedule('update-exchange-rates-daily');

-- 檢查最新匯率更新時間
-- SELECT currency_code, rate, updated_at 
-- FROM exchange_rates 
-- ORDER BY updated_at DESC;

-- =============================================================================
-- Cron 時間表達式說明
-- =============================================================================
-- 格式：分 時 日 月 週
-- 
-- 範例：
-- '0 18 * * *'   - 每天 18:00（UTC）
-- '0 0 * * *'    - 每天 00:00（UTC）= 台灣時間 08:00
-- '0 */6 * * *'  - 每 6 小時執行一次
-- '0 2 * * 1'    - 每週一 02:00
-- '0 0 1 * *'    - 每月 1 號 00:00
-- 
-- 台灣時區（UTC+8）對照表：
-- UTC 00:00 = 台灣時間 08:00（當天）
-- UTC 02:00 = 台灣時間 10:00（當天）⭐ 目前設定
-- UTC 06:00 = 台灣時間 14:00（當天）
-- UTC 12:00 = 台灣時間 20:00（當天）
-- UTC 16:00 = 台灣時間 00:00（隔天）
-- 
-- Exchange Rate API 更新時間：UTC 00:00（台灣時間 08:00）
-- 我們的執行時間：UTC 02:00（台灣時間 10:00），有 2 小時緩衝
-- =============================================================================
