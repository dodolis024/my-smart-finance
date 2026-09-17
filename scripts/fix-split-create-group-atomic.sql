-- =============================================================================
-- Smart Finance Tracker - 建立分帳群組改為單一交易（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-09-17 健檢第 ④ 項。前端建群組是兩段 insert：先 split_groups、
-- 再 split_members（含建立者自己）。第二段失敗（斷網、session 過期）時群組已經存在：
-- 群主靠 owner policy 看得到它，卻不是成員——同步區塊不會出現、新增費用的付款人
-- 預設落到別人、通知函式回 403，而且沒有「把自己加回去」的入口。
--
-- 修法：新增 create_split_group RPC，群組與成員在同一個交易內建立，任一步失敗
-- 整個 rollback。與 2026-07-11 把費用新增包成 add_split_expense 是同一套做法。
-- SECURITY INVOKER：RLS 照常套用，不需要 REVOKE，也沒有 p_user_id 參數。
--
-- 正式定義已同步寫入 database/split-migration.sql 第 14 節，本腳本逐字相同。
-- 錯誤碼 SPLIT_NAME_REQUIRED 已加進 src/lib/splitErrors.js 與雙語 locales。
--
-- 部署順序：先跑本腳本，再 release 前端（新前端改呼叫這支 RPC，沒跑會 404）。
-- 可重複執行（CREATE OR REPLACE，簽章未曾變更過）。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md
-- 的「一次性 SQL 腳本執行紀錄」表格。
-- =============================================================================

BEGIN;

-- =============================================================================
-- 14. 建群組 RPC：群組與成員在同一交易內建立
-- =============================================================================
-- 以前前端分兩步 insert（先群組、再成員），第二步失敗會留下「有群主、沒成員」的群組：
-- 群主看得到它，卻因為不是成員而不能同步、通知發不出去，也沒有把自己加回去的入口。
-- 包成單一交易後任一步失敗整個 rollback（與 add_split_expense 同一套做法）。
-- SECURITY INVOKER：RLS 照常套用（split_groups_insert 已限 owner_id = auth.uid()，
-- split_members_insert 走 can_access_split_group，同一交易內剛建的群組已看得到），
-- 函式本身不需要額外權限，也就不必自己補擁有權檢查。
-- 成員順序決定均分的零頭給誰：建立者先插入、其餘依傳入順序，與前端原本的寫法一致。
CREATE OR REPLACE FUNCTION create_split_group(
  p_name                     TEXT,
  p_my_name                  TEXT,
  p_currency                 TEXT   DEFAULT 'TWD',
  p_default_expense_currency TEXT   DEFAULT NULL,
  p_description              TEXT   DEFAULT NULL,
  p_extra_members            TEXT[] DEFAULT '{}'
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_group   split_groups%ROWTYPE;
  v_member  TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NULLIF(TRIM(p_name), '') IS NULL OR NULLIF(TRIM(p_my_name), '') IS NULL THEN
    RAISE EXCEPTION 'SPLIT_NAME_REQUIRED';
  END IF;

  INSERT INTO split_groups (owner_id, name, description, currency, default_expense_currency)
  VALUES (
    v_user_id,
    TRIM(p_name),
    NULLIF(TRIM(p_description), ''),
    COALESCE(NULLIF(TRIM(p_currency), ''), 'TWD'),
    NULLIF(TRIM(p_default_expense_currency), '')
  )
  RETURNING * INTO v_group;

  -- 建立者自動成為第一位成員
  INSERT INTO split_members (group_id, name, user_id)
  VALUES (v_group.id, TRIM(p_my_name), v_user_id);

  FOREACH v_member IN ARRAY COALESCE(p_extra_members, '{}') LOOP
    IF NULLIF(TRIM(v_member), '') IS NOT NULL THEN
      INSERT INTO split_members (group_id, name, user_id)
      VALUES (v_group.id, TRIM(v_member), NULL);
    END IF;
  END LOOP;

  RETURN row_to_json(v_group);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

COMMIT;

-- =============================================================================
-- 驗證（單一查詢；SQL Editor 只顯示最後一句的輸出）
-- 預期：每一列的「結果」都等於「預期」
-- =============================================================================
SELECT * FROM (
  SELECT 1 AS 序, 'create_split_group 存在且只有一個版本' AS 檢查項目,
    (SELECT count(*)::text FROM pg_proc
      WHERE proname = 'create_split_group' AND pronamespace = 'public'::regnamespace) AS 結果,
    '1' AS 預期
  UNION ALL SELECT 2, '簽章正確',
    (SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
      WHERE proname = 'create_split_group' AND pronamespace = 'public'::regnamespace),
    'p_name text, p_my_name text, p_currency text, p_default_expense_currency text, p_description text, p_extra_members text[]'
  UNION ALL SELECT 3, 'search_path 已鎖',
    (SELECT array_to_string(proconfig, ',') FROM pg_proc
      WHERE proname = 'create_split_group' AND pronamespace = 'public'::regnamespace),
    'search_path=public'
  UNION ALL SELECT 4, '是 SECURITY INVOKER（RLS 照常套用）',
    (SELECT (NOT prosecdef)::text FROM pg_proc
      WHERE proname = 'create_split_group' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 5, 'authenticated 可執行',
    (SELECT has_function_privilege('authenticated',
      'create_split_group(text, text, text, text, text, text[])', 'EXECUTE')::text),
    'true'
  UNION ALL SELECT 6, '既有「群主不在成員名單」的群組數（僅供參考，舊 bug 曾留下的痕跡）',
    (SELECT count(*)::text FROM split_groups g
      WHERE NOT EXISTS (SELECT 1 FROM split_members m WHERE m.group_id = g.id AND m.user_id = g.owner_id)),
    '0（非 0 不擋上線）'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 新版前端建立群組（填自己的名字＋兩位其他成員）→ 群組出現、三位成員齊全、
--      自己標示為已連結、同步區塊出現
--   2) 只填自己、不填其他成員 → 成功，成員只有自己
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在實測失敗時使用；前端未 release 前拿掉函式沒有副作用）
-- =============================================================================
-- DROP FUNCTION IF EXISTS create_split_group(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]);
