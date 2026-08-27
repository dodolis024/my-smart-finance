-- =============================================================================
-- 為 cron 觸發的 Edge Function 加上共用密鑰 header（x-cron-secret）
-- =============================================================================
-- 背景：update-exchange-rates 與 send-streak-reminder 的 verify_jwt = false，
--       任何知道網址的人都能觸發（燒 Exchange Rate API 額度、燒 Brevo 寄信額度，
--       後者運氣不好還會讓使用者收到重複提醒信）。
--       verify_jwt 改 true 沒有防護力：cron 帶的 publishable key 同樣寫在前端
--       bundle 內人人可得，門檻只從「知道網址」變成「知道網址＋抄一把公開 key」。
--       改以 CRON_SECRET（Supabase secrets）比對 x-cron-secret header。
--
-- ⚠️ 執行順序（弄反會有空窗，排程會被自己的函式擋在門外而靜默停擺）：
--    1. supabase secrets set CRON_SECRET=<值> --project-ref rlahfuzsxfbocmkecqvg
--    2. 執行本腳本（此時函式尚未驗證，多帶一個 header 無害）
--    3. 部署驗證版函式：
--       supabase functions deploy update-exchange-rates --project-ref rlahfuzsxfbocmkecqvg --use-api
--       supabase functions deploy send-streak-reminder  --project-ref rlahfuzsxfbocmkecqvg --use-api
--    4. 跑本腳本第 4 段驗證（帶 header 回 200、不帶回 401）
--
-- ⚠️ 執行前：把 <YOUR_CRON_SECRET> 全部取代為步驟 1 設定的值
--
-- 做法：cron.alter_job 只覆寫 command（在既有的 Content-Type header 後面插入一個
--       header），不重建 job——既有的 URL 與 key 原封不動，無 placeholder 風險。
--
-- 執行位置：Supabase Dashboard > SQL Editor
-- 可重複執行：已帶 x-cron-secret 的 job 會跳過（要換密鑰請見檔尾「輪換」）。
-- =============================================================================

-- 1. 執行前的現況
SELECT
  jobname  AS "任務",
  schedule AS "排程",
  active   AS "啟用",
  CASE WHEN command LIKE '%x-cron-secret%' THEN '已帶' ELSE '未帶' END AS "密鑰 header"
FROM cron.job
WHERE jobname IN ('send-streak-reminder-hourly', 'update-exchange-rates-daily')
ORDER BY jobname;

-- 2. 套用
DO $do$
DECLARE
  v_secret  text := '<YOUR_CRON_SECRET>';
  v_anchor  text := $q$extensions.http_header('Content-Type', 'application/json')$q$;
  v_job     record;
  v_new     text;
  v_touched int := 0;
BEGIN
  -- 防呆：忘了取代 placeholder 就中止，不要把字面上的 <YOUR_CRON_SECRET> 寫進排程
  IF v_secret LIKE '<YOUR\_%' THEN
    RAISE EXCEPTION '請先將腳本中的 <YOUR_CRON_SECRET> 全部取代為 CRON_SECRET 的實際值再執行';
  END IF;

  FOR v_job IN
    SELECT jobid, jobname, command
    FROM cron.job
    WHERE jobname IN ('send-streak-reminder-hourly', 'update-exchange-rates-daily')
    ORDER BY jobname
  LOOP
    v_touched := v_touched + 1;

    IF v_job.command LIKE '%<YOUR%' THEN
      RAISE EXCEPTION '% 的 command 內仍有未替換的 placeholder,請先修正 URL/key', v_job.jobname;
    END IF;

    IF v_job.command LIKE '%x-cron-secret%' THEN
      RAISE NOTICE '% 已帶 x-cron-secret,略過', v_job.jobname;
      CONTINUE;
    END IF;

    v_new := replace(
      v_job.command,
      v_anchor,
      v_anchor || ',' || E'\n        ' ||
        format($q$extensions.http_header('x-cron-secret', %L)$q$, v_secret)
    );

    -- command 格式與預期不符時寧可中止,不要以為改好了其實沒改
    IF v_new = v_job.command THEN
      RAISE EXCEPTION '% 的 command 找不到 Content-Type header,需人工加入 x-cron-secret', v_job.jobname;
    END IF;

    PERFORM cron.alter_job(job_id := v_job.jobid, command := v_new);
    RAISE NOTICE '% 已加上 x-cron-secret', v_job.jobname;
  END LOOP;

  IF v_touched <> 2 THEN
    RAISE EXCEPTION '預期處理 2 個 job,實際只找到 %——請確認 jobname 是否被改過', v_touched;
  END IF;
END $do$;

-- 3. 驗證：兩個 job 都應顯示「✅ 已帶」（不顯示密鑰本身）
SELECT
  jobname  AS "任務",
  schedule AS "排程",
  active   AS "啟用",
  CASE WHEN command LIKE '%x-cron-secret%' THEN '✅ 已帶' ELSE '❌ 未帶' END AS "密鑰 header",
  CASE WHEN command LIKE '%<YOUR%' THEN '❌ 仍有未替換的 placeholder' ELSE '✅ 無 placeholder' END AS "placeholder"
FROM cron.job
WHERE jobname IN ('send-streak-reminder-hourly', 'update-exchange-rates-daily')
ORDER BY jobname;

-- =============================================================================
-- 4. 部署驗證版函式之後才跑：確認鎖真的裝上了
-- =============================================================================
-- 以 update-exchange-rates 驗證即可（只會更新匯率,無副作用）。
-- 不要拿 send-streak-reminder 做這個測試——它會真的寄信。

-- 4a. 帶 header：預期 status = 200、content 內含 "success": true
SELECT (r.resp).status AS "HTTP 狀態", (r.resp).content AS "回應內容"
FROM (
  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('x-cron-secret', '<YOUR_CRON_SECRET>')
    ],
    'application/json',
    '{}'
  )::extensions.http_request) AS resp
) r;

-- 4b. 不帶 header：預期 status = 401、content 為 {"success":false,"error":"unauthorized"}
--     若這裡回 200,表示函式還沒部署到驗證版。
SELECT (r.resp).status AS "HTTP 狀態", (r.resp).content AS "回應內容"
FROM (
  SELECT extensions.http((
    'POST',
    'https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates',
    ARRAY[extensions.http_header('Content-Type', 'application/json')],
    'application/json',
    '{}'
  )::extensions.http_request) AS resp
) r;

-- =============================================================================
-- 輪換密鑰（日後若要換掉 CRON_SECRET）
-- =============================================================================
-- 函式只認一把密鑰,所以換的過程一定有短暫空窗,順序是：
--   1. 先跑下面這段把 job 內的舊密鑰換成新值（此時函式仍認舊的,cron 會被擋）
--   2. 立刻 supabase secrets set CRON_SECRET=<新值>（函式改認新的,恢復正常）
-- 空窗期內觸發的排程會拿到 401；匯率每天一次、提醒每 5 分鐘一次,影響有限。
--
-- UPDATE 用不到,直接改 command 內的密鑰字串：
--   SELECT cron.alter_job(
--     job_id  := jobid,
--     command := regexp_replace(
--       command,
--       $r$extensions\.http_header\('x-cron-secret', '[^']*'\)$r$,
--       format($f$extensions.http_header('x-cron-secret', %L)$f$, '<NEW_SECRET>')
--     )
--   )
--   FROM cron.job
--   WHERE jobname IN ('send-streak-reminder-hourly', 'update-exchange-rates-daily');
-- =============================================================================
