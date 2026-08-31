-- =============================================================================
-- 補齊 cron 密鑰保護，並補建從未建立的信用卡繳款提醒排程
-- =============================================================================
-- 背景（一）：process-subscriptions 與 send-credit-card-reminder 函式內沒有任何驗證，
--   而網址就寫在前端 bundle 與 npm 套件 my-smart-finance-cli 的原始碼內。
--   process-subscriptions 會以 service_role 掃描全體使用者並寫入交易，
--   被反覆觸發等於替所有人重複記帳。
--
--   這兩支的 verify_jwt = true（2026-08-31 實測：不帶 Authorization 會被平台閘道
--   擋在 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}），但那不構成防護——閘道認的是
--   publishable key，它跟網址一樣寫在前端 bundle 內人人可得，門檻只從「知道網址」
--   變成「知道網址＋抄一把公開 key」。實測帶上那把 key 就能長驅直入。
--   因此改以 CRON_SECRET 比對 x-cron-secret header，做法與 add-cron-secret-header.sql 一致。
--
-- 背景（二）：send-credit-card-reminder 自 2026-03 上線、2026-07-11 部署至 v4，
--   但 cron.job 內從來沒有對應的排程（README 那段 cron.schedule 未曾執行）。
--   已查證 settings 表 key='credit_card_reminder_last_sent' 為 0 筆，
--   即這支函式從未成功執行過，使用者一次繳款提醒都沒收到。本腳本一併補建。
--
-- ⚠️ 執行順序（弄反會有空窗，排程會被自己的函式擋在門外而靜默停擺）：
--    1. 確認 CRON_SECRET 仍在：
--       supabase secrets list --project-ref rlahfuzsxfbocmkecqvg
--    2. 執行本腳本第 1〜4 段（此時函式尚未驗證，多帶一個 header 無害）
--    3. 部署函式：
--       supabase functions deploy process-subscriptions      --project-ref rlahfuzsxfbocmkecqvg --use-api
--       supabase functions deploy send-credit-card-reminder  --project-ref rlahfuzsxfbocmkecqvg --use-api
--       supabase functions deploy send-credit-usage-alert    --project-ref rlahfuzsxfbocmkecqvg --use-api
--    4. 跑第 5 段驗證
--
-- ⚠️ send-credit-usage-alert 沒有排程要改（它由前端呼叫，不是 cron），但同一批修正
--    改了它的通知開關預設值，所以要一起部署。
--
-- 做法：不需要任何 placeholder，也不需要把 CRON_SECRET 明碼寫進本檔或貼進對話——
--   密鑰由 SQL 自己從 send-streak-reminder-hourly 既有的 command 內抽出來複製過去。
--   抽不到就中止，不會寫入半成品。
--
-- 執行位置：Supabase Dashboard > SQL Editor（第 1〜4 段可整份貼上執行）
-- 可重複執行：已加 header 的 job 會跳過，已存在的排程不會重建。
-- =============================================================================

-- 1. 執行前的現況
SELECT
  jobname  AS "任務",
  schedule AS "排程",
  active   AS "啟用",
  CASE WHEN command LIKE '%x-cron-secret%'     THEN '已帶'   ELSE '未帶'      END AS "密鑰 header",
  CASE WHEN command LIKE '%CURLOPT_TIMEOUT_MS%' THEN '已放寬' ELSE '預設 5 秒' END AS "逾時設定"
FROM cron.job
ORDER BY jobname;

-- =============================================================================
-- 2. 替 process-subscriptions-daily 加上 x-cron-secret
-- =============================================================================
DO $do$
DECLARE
  v_secret  text;
  v_anchor  text := $q$extensions.http_header('Content-Type', 'application/json')$q$;
  v_jobid   bigint;
  v_command text;
  v_new     text;
BEGIN
  -- 從既有 job 抽出 CRON_SECRET（不經由人工複製，避免明碼落到腳本或對話裡）
  SELECT substring(command from $r$x-cron-secret',\s*'([^']*)'$r$)
  INTO v_secret
  FROM cron.job
  WHERE jobname = 'send-streak-reminder-hourly';

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION '無法從 send-streak-reminder-hourly 取得 CRON_SECRET，請確認該 job 存在且已帶 x-cron-secret';
  END IF;

  SELECT jobid, command INTO v_jobid, v_command
  FROM cron.job
  WHERE jobname = 'process-subscriptions-daily';

  IF v_jobid IS NULL THEN
    RAISE EXCEPTION '找不到 job process-subscriptions-daily，請確認 jobname 是否被改過';
  END IF;

  -- 防呆：既有 command 若殘留模板 placeholder，先修那個，不要在壞的 command 上疊加
  IF v_command LIKE '%<YOUR%' THEN
    RAISE EXCEPTION 'process-subscriptions-daily 的 command 內仍有未替換的 placeholder，請先修正 URL/key';
  END IF;

  IF v_command LIKE '%x-cron-secret%' THEN
    RAISE NOTICE 'process-subscriptions-daily 已帶 x-cron-secret，略過';
    RETURN;
  END IF;

  v_new := replace(
    v_command,
    v_anchor,
    v_anchor || ',' || E'\n      ' ||
      format($q$extensions.http_header('x-cron-secret', %L)$q$, v_secret)
  );

  -- command 格式與預期不符時寧可中止，不要以為改好了其實沒改
  IF v_new = v_command THEN
    RAISE EXCEPTION 'process-subscriptions-daily 的 command 找不到 Content-Type header，需人工加入 x-cron-secret';
  END IF;

  PERFORM cron.alter_job(job_id := v_jobid, command := v_new);
  RAISE NOTICE 'process-subscriptions-daily 已加上 x-cron-secret';
END $do$;

-- =============================================================================
-- 3. 補建 credit-card-reminder-daily
-- =============================================================================
-- 直接複製 process-subscriptions-daily 上一段處理完的 command（URL、key、密鑰
-- header 全部原封繼承），只把網址換成 send-credit-card-reminder，因此不會有
-- placeholder，也不必在本檔留下任何金鑰。
--
-- 逾時一開始就設 30 秒：這支函式逐張卡序列發推播（index.ts:133-147 每個
-- endpoint 都 await），與 send-streak-reminder 同樣結構，而 http extension 預設
-- 逾時只有 5 秒（詳見 fix-cron-streak-reminder-timeout.sql）。先設好，免得排程
-- 一上線就天天在 cron.job_run_details 留下誤報的 failed。
--
-- 排程時間 0 1 * * * = 台灣時間每日 09:00，與函式 README 記載一致。
DO $do$
DECLARE
  v_base    text;
  v_command text;
  v_prefix  text := $q$SELECT extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');$q$;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'credit-card-reminder-daily') THEN
    RAISE NOTICE 'credit-card-reminder-daily 已存在，略過建立';
    RETURN;
  END IF;

  SELECT command INTO v_base
  FROM cron.job
  WHERE jobname = 'process-subscriptions-daily';

  IF v_base IS NULL THEN
    RAISE EXCEPTION '找不到 job process-subscriptions-daily，無法複製設定';
  END IF;

  -- 第 2 段應已把密鑰加上，這裡再確認一次，避免建出一個一上線就被 401 擋掉的排程
  IF v_base NOT LIKE '%x-cron-secret%' THEN
    RAISE EXCEPTION 'process-subscriptions-daily 尚未帶 x-cron-secret，請先確認第 2 段執行成功';
  END IF;

  v_command := replace(
    v_base,
    '/functions/v1/process-subscriptions',
    '/functions/v1/send-credit-card-reminder'
  );

  IF v_command = v_base THEN
    RAISE EXCEPTION '在 process-subscriptions-daily 的 command 內找不到函式網址，需人工建立排程';
  END IF;

  PERFORM cron.schedule(
    'credit-card-reminder-daily',
    '0 1 * * *',
    v_prefix || E'\n' || v_command
  );

  RAISE NOTICE 'credit-card-reminder-daily 已建立（台灣時間每日 09:00）';
END $do$;

-- =============================================================================
-- 4. 驗證（不顯示密鑰本身）
-- =============================================================================
-- 預期：四個 job 的「密鑰 header」全部為 ✅ 已帶。
SELECT
  jobname  AS "任務",
  schedule AS "排程",
  active   AS "啟用",
  CASE WHEN command LIKE '%x-cron-secret%' THEN '✅ 已帶' ELSE '❌ 未帶' END AS "密鑰 header",
  CASE WHEN command LIKE '%<YOUR%' THEN '❌ 仍有未替換的 placeholder' ELSE '✅ 無 placeholder' END AS "placeholder",
  substring(command from '/functions/v1/([a-z-]+)') AS "觸發的函式"
FROM cron.job
ORDER BY jobname;

-- =============================================================================
-- 5. 部署驗證版函式之後才跑：確認鎖真的裝上了
-- =============================================================================
-- ⚠️ 正向測試（帶 header）只拿 update-exchange-rates 做，它只更新匯率、無副作用。
--    不要對 process-subscriptions 做正向測試——它會真的替所有人建立訂閱交易。
--    也不要對 send-credit-card-reminder 做——它會真的推播給使用者。

-- 5a. 正向：確認兩個新 job 內的密鑰真的對得上
--
--     直接打那兩支函式不行——process-subscriptions 會真的替所有人記帳，
--     send-credit-card-reminder 會真的推播。所以改成把「那個 job 自己 command 裡的
--     密鑰」抽出來，拿去打 update-exchange-rates（只更新匯率、無副作用）。
--     密鑰是同一把，打得通就代表該 job 明天送出的 header 也會被函式接受。
--
--     預期兩列都是 200 且內容含 "success"。出現 401 表示密鑰複製錯了，
--     排程會靜默停擺，要立刻查。
SELECT
  j.jobname                AS "任務",
  (r.resp).status          AS "HTTP 狀態",
  left((r.resp).content, 120) AS "回應內容"
FROM cron.job j
CROSS JOIN LATERAL (
  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header(
        'x-cron-secret',
        substring(j.command from $r$x-cron-secret',\s*'([^']*)'$r$)
      )
    ],
    'application/json',
    '{}'
  )::extensions.http_request) AS resp
) r
WHERE j.jobname IN ('process-subscriptions-daily', 'credit-card-reminder-daily')
ORDER BY j.jobname;

-- 5b. 反向：模擬攻擊者，帶公開 key 過閘道但不帶 x-cron-secret，預期被 guard 擋下。
--     被擋下就不會有任何副作用，所以這兩支可以安全測試。
--
-- ⚠️ 一定要帶 Authorization/apikey（那把 publishable key 本來就寫在前端 bundle 內，
--    不是機密）。完全不帶 header 的話，平台閘道會先回
--    {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}，請求根本進不到函式——那個 401 是閘道
--    給的，證明不了 guard 有沒有裝上，很容易誤判成驗證通過。
--
--    判讀看「回應內容」而不是只看狀態碼：
--      {"success":false,"error":"unauthorized"}  → ✅ 函式自己的 guard 生效
--      {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}    → ⚠️ 只到閘道，這次測試無效
--      200                                        → ❌ 函式還沒部署到驗證版，
--                                                    且它剛剛已經真的執行了一次
SELECT
  f.fn                     AS "函式",
  (r.resp).status          AS "HTTP 狀態",
  left((r.resp).content, 120) AS "回應內容"
FROM (VALUES ('process-subscriptions'), ('send-credit-card-reminder')) AS f(fn)
CROSS JOIN LATERAL (
  SELECT substring(command from $r$Bearer ([A-Za-z0-9_]+)$r$) AS key
  FROM cron.job WHERE jobname = 'process-subscriptions-daily'
) k
CROSS JOIN LATERAL (
  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/' || f.fn,
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('apikey', k.key),
      extensions.http_header('Authorization', 'Bearer ' || k.key)
    ],
    'application/json',
    '{}'
  )::extensions.http_request) AS resp
) r
ORDER BY f.fn;

-- =============================================================================
-- 6. 隔天觀察
-- =============================================================================
-- 注意：succeeded 只代表 HTTP 請求送得出去，Edge Function 內部回 401/500
--       在這裡照樣顯示成功——所以下面第二段要一併看回應內容。
SELECT
  j.jobname                                    AS "任務",
  d.status                                     AS "狀態",
  count(*)                                     AS "次數",
  max(d.start_time AT TIME ZONE 'Asia/Taipei') AS "最近一次_台灣"
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
WHERE j.jobname IN ('process-subscriptions-daily', 'credit-card-reminder-daily')
  AND d.start_time > now() - interval '48 hours'
GROUP BY j.jobname, d.status
ORDER BY j.jobname, d.status;

-- 確認信用卡提醒真的開始運作（第一次成功發送後才會有資料）
SELECT count(*) AS "有寄送紀錄的人數"
FROM settings WHERE key = 'credit_card_reminder_last_sent';

-- =============================================================================
-- rollback
-- =============================================================================
-- 移除補建的排程：
--   SELECT cron.unschedule('credit-card-reminder-daily');
--
-- 拿掉 process-subscriptions-daily 的密鑰 header（僅在函式退版回無驗證時才需要）：
--   SELECT cron.alter_job(
--     job_id  := jobid,
--     command := regexp_replace(
--       command,
--       $r$,\s*extensions\.http_header\('x-cron-secret', '[^']*'\)$r$,
--       ''
--     )
--   )
--   FROM cron.job WHERE jobname = 'process-subscriptions-daily';
--
-- 輪換 CRON_SECRET 的做法見 add-cron-secret-header.sql 檔尾。
-- =============================================================================
