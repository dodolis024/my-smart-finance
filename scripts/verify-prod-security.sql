-- =============================================================================
-- Smart Finance Tracker - prod 安全狀態驗證（唯讀，可重複執行）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 用途：每次跑完 migration 後執行一次，把 prod 實際的 RLS、policy、SECURITY DEFINER
-- 函式授權、trigger、CHECK 約束、多版本函式全部列出來，對照 database/ 與 scripts/。
-- 只有 SELECT，不改任何東西。合併成單一查詢是因為 SQL Editor 只顯示最後一句的輸出。
--
-- 逐區該看到什麼：
--   1-RLS      所有表 rls=true
--   2-POLICY   每條寫入 policy 的條件不是 auth.uid() = user_id 就是 can_access_split_group()
--   3-DEFINER  calculate_streak_stats / create_default_accounts / create_default_settings /
--              get_user_emails 四支 anon=false authenticated=false；
--              任何一支 search_path=NONE! 都要處理
--   4-TRIGGER  assert_split_expense_balanced / assert_split_shares_balanced
--              deferrable=true initdeferred=true
--   5-CHECK    transactions_amount_nonnegative / split_expense_shares_share_nonnegative
--              validated=true
--   6-OVERLOAD **必須是空的**。2026-09-17 就是在這一區抓到只存在於 prod 的舊版
--              join_split_group_as_new_member(uuid, text)（無邀請碼檢查），
--              CREATE OR REPLACE 不會替換簽章不同的函式，舊版會一直活著。
-- =============================================================================
SELECT * FROM (
  -- 1. 每張表的 RLS 開關
  SELECT '1-RLS' AS 區, c.relname::text AS 項目,
         'rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text AS 內容
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'

  UNION ALL
  -- 2. 所有 policy 的條件原文
  SELECT '2-POLICY', tablename::text || ' / ' || policyname::text,
         cmd::text || ' roles=' || array_to_string(roles, ',') ||
         ' USING=' || COALESCE(qual, '-') ||
         ' CHECK=' || COALESCE(with_check, '-')
  FROM pg_policies WHERE schemaname = 'public'

  UNION ALL
  -- 3. 每支 SECURITY DEFINER 函式：誰能執行、有沒有用 auth.uid()、search_path 有沒有鎖
  SELECT '3-DEFINER', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text ||
         ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
         ' uses_auth_uid=' || (pg_get_functiondef(p.oid) LIKE '%auth.uid()%')::text ||
         ' search_path=' || COALESCE(array_to_string(p.proconfig, ','), 'NONE!')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef

  UNION ALL
  -- 4. 所有 trigger 的狀態（tgenabled 是 "char"，要明確轉型）
  SELECT '4-TRIGGER', c.relname::text || ' / ' || t.tgname::text,
         'enabled=' || t.tgenabled::text || ' deferrable=' || t.tgdeferrable::text ||
         ' initdeferred=' || t.tginitdeferred::text || ' fn=' || p.proname::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal

  UNION ALL
  -- 5. 所有 CHECK 約束
  SELECT '5-CHECK', conrelid::regclass::text || ' / ' || conname::text,
         pg_get_constraintdef(oid) || ' validated=' || convalidated::text
  FROM pg_constraint
  WHERE contype = 'c' AND connamespace = 'public'::regnamespace

  UNION ALL
  -- 6. 同名多版本的函式（不限 SECURITY DEFINER）
  SELECT '6-OVERLOAD', proname::text,
         count(*)::text || ' 版：' || string_agg(pg_get_function_identity_arguments(oid), ' | ')
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
  GROUP BY proname HAVING count(*) > 1
) v ORDER BY 區, 項目;
