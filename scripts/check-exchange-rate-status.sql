-- =============================================================================
-- 匯率系統狀態檢查 SQL
-- =============================================================================
-- 此腳本用於檢查匯率更新系統是否正常運作
-- 執行位置：Supabase Dashboard > SQL Editor
-- =============================================================================

-- 1️⃣ 檢查匯率表最後更新時間
-- =============================================================================
SELECT 
    '📊 匯率表狀態' AS category,
    currency_code AS 幣別,
    rate AS 匯率,
    updated_at AS 最後更新時間,
    updated_at AT TIME ZONE 'Asia/Taipei' AS 台灣時間,
    NOW() - updated_at AS 距今時間,
    CASE 
        WHEN NOW() - updated_at < INTERVAL '1 day' THEN '✅ 今日已更新'
        WHEN NOW() - updated_at < INTERVAL '2 days' THEN '⚠️ 昨日更新（可能未執行）'
        ELSE '❌ 超過 2 天未更新'
    END AS 狀態
FROM exchange_rates
ORDER BY updated_at DESC;

-- =============================================================================
-- 2️⃣ 檢查 cron job 是否正常運作
-- =============================================================================
SELECT 
    '⏰ Cron Job 狀態' AS category,
    jobid AS 任務ID,
    jobname AS 任務名稱,
    schedule AS 排程時間,
    active AS 是否啟用,
    CASE 
        WHEN active THEN '✅ 已啟用'
        ELSE '❌ 已停用'
    END AS 狀態
FROM cron.job
WHERE jobname = 'update-exchange-rates-daily';

-- =============================================================================
-- 3️⃣ 檢查最近 5 次 cron job 執行記錄
-- =============================================================================
SELECT 
    '📜 執行歷史（最近 5 次）' AS category,
    runid AS 執行ID,
    status AS 狀態,
    start_time AT TIME ZONE 'Asia/Taipei' AS 開始時間_台灣,
    end_time AT TIME ZONE 'Asia/Taipei' AS 結束時間_台灣,
    EXTRACT(EPOCH FROM (end_time - start_time)) AS 執行秒數,
    return_message AS 回傳訊息,
    CASE 
        WHEN status = 'succeeded' THEN '✅ 成功'
        WHEN status = 'failed' THEN '❌ 失敗'
        ELSE status
    END AS 結果
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'update-exchange-rates-daily')
ORDER BY start_time DESC
LIMIT 5;

-- =============================================================================
-- 4️⃣ 檢查下次執行時間
-- =============================================================================
SELECT 
    '🔮 下次執行時間' AS category,
    jobname AS 任務名稱,
    schedule AS 排程,
    CASE 
        WHEN schedule = '0 2 * * *' THEN 'UTC 02:00（台灣時間 10:00）'
        WHEN schedule = '0 18 * * *' THEN 'UTC 18:00（台灣時間隔天 02:00）'
        ELSE schedule
    END AS 說明
FROM cron.job
WHERE jobname = 'update-exchange-rates-daily';

-- =============================================================================
-- 5️⃣ 完整健康檢查總結
-- =============================================================================
WITH rate_check AS (
    SELECT 
        COUNT(*) AS total_currencies,
        MAX(updated_at) AS latest_update,
        MIN(updated_at) AS oldest_update,
        CASE 
            WHEN MAX(NOW() - updated_at) < INTERVAL '1 day' THEN true
            ELSE false
        END AS is_updated_today
    FROM exchange_rates
),
cron_check AS (
    SELECT 
        COUNT(*) AS job_count,
        MAX(CASE WHEN active THEN 1 ELSE 0 END) AS is_active
    FROM cron.job
    WHERE jobname = 'update-exchange-rates-daily'
),
last_run AS (
    SELECT 
        status,
        start_time,
        end_time
    FROM cron.job_run_details
    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'update-exchange-rates-daily')
    ORDER BY start_time DESC
    LIMIT 1
)
SELECT 
    '🏥 系統健康檢查總結' AS "=== 總覽 ===",
    CASE 
        WHEN r.is_updated_today AND c.is_active = 1 THEN '✅ 系統運作正常'
        WHEN NOT r.is_updated_today AND c.is_active = 1 THEN '⚠️ 排程正常但匯率未更新'
        WHEN r.is_updated_today AND c.is_active = 0 THEN '⚠️ 匯率已更新但排程已停用'
        ELSE '❌ 系統異常'
    END AS 整體狀態,
    r.total_currencies AS 幣別數量,
    r.latest_update AT TIME ZONE 'Asia/Taipei' AS 最新更新時間_台灣,
    c.job_count AS 排程任務數,
    CASE WHEN c.is_active = 1 THEN '✅ 已啟用' ELSE '❌ 已停用' END AS 排程狀態,
    lr.status AS 上次執行結果,
    lr.start_time AT TIME ZONE 'Asia/Taipei' AS 上次執行時間_台灣
FROM rate_check r
CROSS JOIN cron_check c
LEFT JOIN last_run lr ON true;

-- =============================================================================
-- 快速檢查指令（複製貼上即可）
-- =============================================================================

-- 快速查看：匯率是否今日更新？
-- SELECT currency_code, updated_at AT TIME ZONE 'Asia/Taipei' AS 台灣時間 
-- FROM exchange_rates 
-- ORDER BY updated_at DESC;

-- 快速查看：排程是否啟用？
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'update-exchange-rates-daily';

-- 快速查看：最近一次執行結果
-- SELECT status, start_time AT TIME ZONE 'Asia/Taipei' AS 台灣時間, return_message 
-- FROM cron.job_run_details 
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'update-exchange-rates-daily')
-- ORDER BY start_time DESC LIMIT 1;
