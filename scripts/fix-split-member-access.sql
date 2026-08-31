-- =============================================================================
-- Smart Finance Tracker - 分帳成員存取權修正（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-08-31 資安健檢發現一條可實際利用的跨用戶資料外洩鏈。本腳本修正
-- 三個互相扣合的問題，缺任何一項都補不完整。
--
-- ① split_members 的 INSERT policy 有繞過邀請機制的側門（嚴重）
--    現行 policy：
--      WITH CHECK (can_access_split_group(group_id, auth.uid()) OR user_id = auth.uid())
--    第二個條件只檢查「寫入的那一列 user_id 是不是自己」，完全不檢查 group_id。
--    任何登入用戶只要知道群組 id，即可把自己寫入成員名單，取得該群組全部費用、
--    金額、備註、成員姓名與結算資料的讀寫權。
--
--    這使 join_split_group_as_new_member 的防護失效——該函式刻意只收邀請碼、
--    不收 group_id（見 database/split-migration.sql 該函式註解），但用戶端可以
--    完全不經過它，直接對表 INSERT。
--
--    實測（2026-08-31，以真實帳號對全 0 group_id 寫入）：
--      → 23503 foreign key violation（群組不存在）
--      → 而非 42501 RLS violation
--    證實 RLS 已放行，唯一擋下它的是「該群組不存在」。
--
--    修法：移除 OR user_id = auth.uid()。經確認前端四個寫入點皆不依賴它——
--    建群與加成員時使用者已是 owner／成員，走第一個條件即可通過；用邀請碼加入
--    與連結既有成員位置都走 SECURITY DEFINER 的 RPC，本就繞過 RLS。
--
-- ② UPDATE 路徑可把自己那列「搬」到別的群組（同一個洞的另一扇門）
--    split_members_update 的 USING 含 user_id = auth.uid() 且未指定 WITH CHECK。
--    Postgres 在缺 WITH CHECK 時沿用 USING，而改完 group_id 之後 user_id 仍是
--    自己，該條件依然成立 → 放行。
--
--    補 WITH CHECK 無法解決：WITH CHECK 只看得到新值，看不到舊值，天生無法
--    表達「這個欄位不准動」。與 protect_split_group_ownership 當初選擇 trigger
--    而非 policy 的理由相同，此處沿用同一模式。
--
--    修法：加 BEFORE UPDATE trigger 鎖住 group_id，並限縮 user_id 的可變更情境。
--
-- ③ 兩支內部輔助函式可被匿名呼叫，成為①的偵察管道
--    get_user_split_group_ids(p_user_id) 為 SECURITY DEFINER 且接受任意
--    p_user_id。實測未帶任何登入憑證即可取得指定用戶所屬的全部分帳群組 id
--    （HTTP 200，回傳 3 筆）。有了 group_id 就能接上①。
--    can_access_split_group(p_group_id, p_user_id) 同樣可被匿名呼叫，可當作
--    「某人是否為某群組成員」的查詢 oracle。
--
--    ⚠️ 不可用 REVOKE 處理：這兩支被寫在十幾條 RLS policy 的判斷式裡
--    （split_groups_member_select、split_expenses_* 等）。policy 判斷式是以
--    發出查詢的使用者身分執行，REVOKE 掉 authenticated 會讓每個登入用戶一讀
--    分帳表就撞 permission denied，整個分帳功能掛掉。
--    （calculate_streak_stats 那個 REVOKE 之所以可行，是因為它從 SECURITY
--      DEFINER 函式內部被呼叫，與 policy 內呼叫是兩回事，不能類推。）
--
--    修法：保留執行權，改在函式內加「只回答關於呼叫者自己的問題」的限制。
--    已確認全部 22 個呼叫點傳入的都是 auth.uid()，因此對正常流程零影響；
--    匿名或代入他人 user_id 的查詢一律得到空集合／false。
--
-- 對應的正式定義已同步更新於 database/split-migration.sql
--
-- -----------------------------------------------------------------------------
-- 部署順序：僅需執行本腳本。無前端相依，不需重新部署前端或 Edge Functions。
--           三段可一次執行完。第 3 段不更動函式簽章，policy 不受影響。
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. 移除 INSERT policy 的側門
-- =============================================================================
DROP POLICY IF EXISTS "split_members_insert" ON split_members;
CREATE POLICY "split_members_insert" ON split_members
  FOR INSERT WITH CHECK (
    can_access_split_group(group_id, auth.uid())
  );

-- =============================================================================
-- 2. 以 trigger 鎖住 group_id 與 user_id
-- =============================================================================
-- user_id 只允許三種變更情境，缺一不可：
--   a) 群組擁有者調整成員連結（管理需求）
--   b) 認領空位：OLD.user_id IS NULL → NEW.user_id = 自己
--      link_self_to_split_member 走的就是這條。該函式為 SECURITY DEFINER，
--      但 trigger 一樣會觸發（SECURITY DEFINER 只改權限檢查的身分，不跳過
--      trigger），漏掉這條會直接讓「加入既有成員位置」壞掉。
--   c) 自行解除連結：OLD.user_id = 自己 → NEW.user_id IS NULL
--
-- auth.uid() IS NULL 的情形直接放行：那代表 service_role 或 SQL Editor
-- 直連（兩者本就繞過 RLS、擁有完整權限），擋它只會讓日後無法用 SQL 修資料。
-- anon 不在此列——RLS 的 USING 已先擋掉匿名 UPDATE（user_id = NULL 比較
-- 結果為 NULL，不成立），走不到 trigger。
CREATE OR REPLACE FUNCTION protect_split_member_identity()
RETURNS TRIGGER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'SPLIT_MEMBER_GROUP_IMMUTABLE';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NOT (
       EXISTS (SELECT 1 FROM split_groups WHERE id = OLD.group_id AND owner_id = auth.uid())
    OR (OLD.user_id IS NULL      AND NEW.user_id = auth.uid())
    OR (OLD.user_id = auth.uid() AND NEW.user_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'SPLIT_MEMBER_OWNER_ONLY';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_split_member_identity ON split_members;
CREATE TRIGGER protect_split_member_identity
  BEFORE UPDATE ON split_members
  FOR EACH ROW
  EXECUTE FUNCTION protect_split_member_identity();

-- =============================================================================
-- 3. 讓兩支輔助函式只回答關於呼叫者自己的問題
-- =============================================================================
-- 兩支函式的簽章、回傳型別、SECURITY DEFINER / STABLE / search_path 全部維持
-- 原樣（policy 相依於簽章，不可更動），只在查詢條件加上 p_user_id = auth.uid()。
-- 未登入時 auth.uid() 為 NULL，比較結果為 NULL，兩支都會落到空集合／false。
CREATE OR REPLACE FUNCTION get_user_split_group_ids(p_user_id UUID)
RETURNS SETOF UUID AS $$
  SELECT group_id FROM split_members
  WHERE user_id = p_user_id
    AND p_user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION can_access_split_group(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT p_user_id IS NOT NULL
     AND p_user_id = auth.uid()
     AND (
       EXISTS (
         SELECT 1 FROM split_groups
         WHERE id = p_group_id AND owner_id = p_user_id
       )
       OR EXISTS (
         SELECT 1 FROM split_members
         WHERE group_id = p_group_id AND user_id = p_user_id
       )
     );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================================================
-- 4. 驗證
-- =============================================================================
-- 4a. policy 現況：split_members_insert 的 with_check 不應再含 user_id = auth.uid()
SELECT policyname AS "policy", cmd AS "動作", qual AS "USING", with_check AS "WITH CHECK"
FROM pg_policies
WHERE tablename = 'split_members'
ORDER BY policyname;

-- 4b. trigger 已建立
SELECT tgname AS "trigger"
FROM pg_trigger
WHERE tgrelid = 'split_members'::regclass AND NOT tgisinternal;

-- 4c. 兩支函式的定義已含 auth.uid() 自我限制（兩筆都應顯示「已限制」）
SELECT p.proname AS "函式",
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%p_user_id = auth.uid()%'
            THEN '已限制' ELSE '未套用' END AS "狀態"
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('get_user_split_group_ids', 'can_access_split_group');

-- 4c-2. 代入他人 user_id 應得空集合／false（用任一非自己的 user_id 測）
--   SELECT * FROM get_user_split_group_ids('<別人的 user_id>');   -- 應 0 筆
--   SELECT can_access_split_group('<任一 group_id>', '<別人的 user_id>');  -- 應 false

-- 4d. 事後檢查：是否有疑似被利用而插入的成員列
--     （加入時間明顯晚於群組建立、且名稱不在預期內者需人工確認）
SELECT sg.name AS "群組", sm.name AS "成員", sm.user_id, sm.created_at AS "加入時間",
       sg.created_at AS "群組建立時間"
FROM split_members sm
JOIN split_groups sg ON sg.id = sm.group_id
ORDER BY sm.created_at DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 建立新分帳群組（含額外成員）→ 應成功
--   2) 對既有群組新增成員 → 應成功
--   3) 修改成員名字 → 應成功
--   4) 用邀請碼加入群組（另一個帳號）→ 應成功
--   5) 連結到既有的空成員位置 → 應成功（驗 trigger 的認領空位條件）
--   6) 分帳列表頁、群組明細頁、結算頁、同步到帳本 → 皆應正常，無 403
--   7) 未登入呼叫 get_user_split_group_ids → 應回空陣列 []（不再洩漏群組 id）
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在上述實測失敗時使用）
-- =============================================================================
-- 第 1 段還原：
--   DROP POLICY IF EXISTS "split_members_insert" ON split_members;
--   CREATE POLICY "split_members_insert" ON split_members
--     FOR INSERT WITH CHECK (
--       can_access_split_group(group_id, auth.uid())
--       OR user_id = auth.uid()
--     );
--   ⚠️ 這會把外洩鏈重新打開，只應作為緊急止血，且需盡快重做。
--
-- 第 2 段還原：
--   DROP TRIGGER IF EXISTS protect_split_member_identity ON split_members;
--
-- 第 3 段還原：把兩支函式的 WHERE / SELECT 條件中的 p_user_id = auth.uid()
--   拿掉即可，其餘照 database/split-migration.sql 的 7.5 節原樣重建。
--   （簽章未變，policy 不受影響，還原不需要動 policy。）
-- =============================================================================
