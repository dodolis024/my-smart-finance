-- =============================================================================
-- 安全性強化批次的驗收 SQL（2026-08-31 批次）
-- =============================================================================
-- 一次驗完以下 5 支腳本是否真的生效：
--   scripts/fix-split-member-access.sql
--   scripts/fix-split-avatar-rpc.sql
--   scripts/fix-invite-code-hardening.sql
--   scripts/fix-split-sync-ownership.sql
--   scripts/fix-cron-auth-and-credit-card-schedule.sql
--
-- 執行位置：Supabase Dashboard > SQL Editor
-- 唯讀，不更動任何資料；可重複執行。
--
-- 刻意寫成「單一查詢」：SQL Editor 執行多段 SQL 時只顯示最後一句的輸出，
-- 拆成多個 SELECT 等於前面幾項白驗（RAISE NOTICE 同樣不顯示，別用）。
-- 日後擴充請照樣掛在同一串 UNION ALL 上，不要另起一句。
--
-- 邀請碼、密鑰本身一律不輸出——驗收結果常被截圖或貼上，
-- 這裡只回報「有沒有」與「對不對」，不回報值。
--
-- 預期：每一列的「結果」都等於「預期」。
--
-- 第 20〜22 列是重點：前面 19 列只證明設定改對了，這三列才證明它真的在跑。
-- credit-card-reminder-daily 曾經函式部署好、排程卻從未建立而靜默三個月，
-- 光看 active = true 判斷不出來（見 docs/DEPLOYMENT.md 的 pg_cron 排程一節）。
--
-- SQL 驗不出來、仍須人工實測的部分見各 fix 腳本檔尾的「執行後必須實測」。
-- =============================================================================
SELECT * FROM (
  -- ── fix-split-member-access.sql ──────────────────────────────────────────
  SELECT 1 AS 序, 'member-access' AS 腳本, 'INSERT policy 已移除側門' AS 檢查項目,
    (SELECT (with_check NOT LIKE '%user_id = auth.uid()%')::text FROM pg_policies
      WHERE tablename = 'split_members' AND policyname = 'split_members_insert') AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, 'member-access', 'protect_split_member_identity trigger 啟用中',
    (SELECT tgenabled::text FROM pg_trigger
      WHERE tgrelid = 'split_members'::regclass AND tgname = 'protect_split_member_identity'),
    'O'
  UNION ALL SELECT 3, 'member-access', 'get_user_split_group_ids 已自我限制',
    (SELECT (pg_get_functiondef(oid) LIKE '%p_user_id = auth.uid()%')::text FROM pg_proc
      WHERE proname = 'get_user_split_group_ids' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 4, 'member-access', 'can_access_split_group 已自我限制',
    (SELECT (pg_get_functiondef(oid) LIKE '%p_user_id = auth.uid()%')::text FROM pg_proc
      WHERE proname = 'can_access_split_group' AND pronamespace = 'public'::regnamespace),
    'true'

  -- ── fix-split-avatar-rpc.sql ─────────────────────────────────────────────
  UNION ALL SELECT 5, 'avatar-rpc', '單筆版死碼已移除',
    (SELECT count(*)::text FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'get_split_member_avatars'),
    '0'
  UNION ALL SELECT 6, 'avatar-rpc', '批次版有 200 組上限',
    (SELECT (pg_get_functiondef(oid) LIKE '%SPLIT_TOO_MANY_GROUPS%')::text FROM pg_proc
      WHERE proname = 'get_split_member_avatars_batch' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 7, 'avatar-rpc', '批次版有呼叫者權限檢查',
    (SELECT (pg_get_functiondef(oid) LIKE '%can_access_split_group%')::text FROM pg_proc
      WHERE proname = 'get_split_member_avatars_batch' AND pronamespace = 'public'::regnamespace),
    'true'

  -- ── fix-invite-code-hardening.sql ────────────────────────────────────────
  UNION ALL SELECT 8, 'invite-code', '產生器使用 CSPRNG',
    (SELECT (pg_get_functiondef(oid) LIKE '%gen_random_bytes%')::text FROM pg_proc
      WHERE proname = 'generate_invite_code' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 9, 'invite-code', '查詢 RPC 有登入檢查',
    (SELECT (pg_get_functiondef(oid) LIKE '%AUTH_REQUIRED%')::text FROM pg_proc
      WHERE proname = 'get_group_by_invite_code' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 10, 'invite-code', '邀請碼長度不是 10 的群組數',
    (SELECT count(*)::text FROM split_groups WHERE length(invite_code) <> 10),
    '0'

  -- ── fix-split-sync-ownership.sql ─────────────────────────────────────────
  UNION ALL SELECT 11, 'sync-ownership', '同步函式有 account 擁有權檢查',
    (SELECT (pg_get_functiondef(oid) LIKE '%ACCOUNT_NOT_OWNED%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 12, 'sync-ownership', '交易 UPDATE 有比對擁有者',
    (SELECT (pg_get_functiondef(oid) LIKE '%AND user_id = v_user_id%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 13, 'sync-ownership', 'assert_sync_tx_owned trigger 啟用中',
    (SELECT tgenabled::text FROM pg_trigger
      WHERE tgrelid = 'split_ledger_syncs'::regclass AND tgname = 'assert_sync_tx_owned'),
    'O'
  UNION ALL SELECT 14, 'sync-ownership', '既有同步記錄指向他人交易的筆數',
    (SELECT count(*)::text FROM split_ledger_syncs s
      WHERE NOT EXISTS (SELECT 1 FROM transactions t
                        WHERE t.id = s.transaction_id AND t.user_id = s.user_id)),
    '0'

  -- ── fix-cron-auth-and-credit-card-schedule.sql ───────────────────────────
  UNION ALL SELECT 15, 'cron-auth', 'process-subscriptions-daily 帶密鑰 header',
    (SELECT (command LIKE '%x-cron-secret%')::text FROM cron.job
      WHERE jobname = 'process-subscriptions-daily'),
    'true'
  UNION ALL SELECT 16, 'cron-auth', 'credit-card-reminder-daily 排程存在且啟用',
    (SELECT active::text FROM cron.job WHERE jobname = 'credit-card-reminder-daily'),
    'true'
  UNION ALL SELECT 17, 'cron-auth', 'credit-card-reminder-daily 帶密鑰 header',
    (SELECT (command LIKE '%x-cron-secret%')::text FROM cron.job
      WHERE jobname = 'credit-card-reminder-daily'),
    'true'
  UNION ALL SELECT 18, 'cron-auth', 'credit-card-reminder-daily 逾時已放寬',
    (SELECT (command LIKE '%CURLOPT_TIMEOUT_MS%30000%')::text FROM cron.job
      WHERE jobname = 'credit-card-reminder-daily'),
    'true'
  UNION ALL SELECT 19, 'cron-auth', '所有 job 都沒有未替換的 placeholder',
    (SELECT count(*)::text FROM cron.job WHERE command LIKE '%<YOUR%'),
    '0'

  -- ── 真的有在跑嗎（光看設定不夠）────────────────────────────────────────
  UNION ALL SELECT 20, '實際執行', 'credit-card-reminder-daily 最近一次成功',
    (SELECT coalesce(max(d.start_time)::text, '❌ 從未成功執行') FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE j.jobname = 'credit-card-reminder-daily' AND d.status = 'succeeded'),
    '一天內的時間'
  UNION ALL SELECT 21, '實際執行', 'process-subscriptions-daily 最近一次成功',
    (SELECT coalesce(max(d.start_time)::text, '❌ 從未成功執行') FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE j.jobname = 'process-subscriptions-daily' AND d.status = 'succeeded'),
    '一天內的時間'
  UNION ALL SELECT 22, '實際執行', '四個 cron job 近 3 天的失敗次數',
    (SELECT count(*)::text FROM cron.job_run_details d
      WHERE d.status <> 'succeeded' AND d.start_time > now() - interval '3 days'),
    '0'
) v ORDER BY 序;
