-- =============================================================================
-- 修正 cron job 的 HTTP 呼叫語法
-- =============================================================================
-- 問題：extensions.http_post 函數不存在
-- 解決：改用正確的 extensions.http() 函數
-- 
-- ⚠️ 執行前請先替換：
-- <YOUR_SUPABASE_URL>: 你的 Supabase 專案 URL
-- <YOUR_SUPABASE_ANON_KEY>: 你的 Supabase Anon Key
-- =============================================================================

-- 1. 確保 http 擴展已啟用
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- 2. 刪除舊的（錯誤的）排程
SELECT cron.unschedule('update-exchange-rates-daily');

-- 3. 建立新的（正確的）排程
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

-- 4. 驗證新排程
SELECT jobid, jobname, schedule, active, command 
FROM cron.job 
WHERE jobname = 'update-exchange-rates-daily';

-- 應該顯示：
-- jobid | jobname                     | schedule   | active | command
-- ------|----------------------------|------------|--------|----------
-- 1     | update-exchange-rates-daily | 0 2 * * *  | true   | SELECT extensions.http...

-- =============================================================================
-- 5. 立即手動測試一次（驗證語法正確）
-- =============================================================================
-- 取消以下註解來立即執行一次測試：
/*
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
  )::extensions.http_request);
*/

-- 如果成功，應該回傳 HTTP 200 的 response
-- 然後檢查 exchange_rates 表的 updated_at 欄位是否更新
