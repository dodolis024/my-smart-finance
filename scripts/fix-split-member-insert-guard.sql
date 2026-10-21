-- =============================================================================
-- Smart Finance Tracker - 分帳成員「被塞進群組」與「無法退出」修正（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行；可重複執行
-- =============================================================================
--
-- 背景：2026-10-21 審查發現 split_members 還有兩個洞，修法互相扣合，要一起上。
--
-- ① 任何成員都能把任意 user_id 塞進自己群組的成員名單
--    split_members_insert 的 WITH CHECK 只有 can_access_split_group(group_id, auth.uid())，
--    沒檢查寫入列的 user_id。成員對表直接 INSERT { group_id: 自己的群組, user_id: 別人 }
--    就會成功，對方的分帳列表多出一個他從沒加入過的群組（看得到費用、會收到推播）。
--    protect_split_member_identity 只掛 BEFORE UPDATE，INSERT 不經過它；它的「群主可改
--    user_id」分支也允許群主把成員連到任意 UUID，是同一個洞的 UPDATE 版。
--
--    修法：
--      a) INSERT 只允許寫「沒連結帳號的空位」或「自己」。
--      b) trigger 的群主分支改成只能「解除連結」（NEW.user_id IS NULL），不能連到別的帳號。
--         「認領空位」與「自行解除」兩條保留。
--
-- ② 非群主無法退出（解除自己的連結）
--    split_members_update 沒寫 WITH CHECK，Postgres 拿 USING 檢查新列：
--    把自己那列的 user_id 改成 NULL 後 user_id = auth.uid() 不成立 → 被擋。
--    加上 ①，被塞進群組的人連自救都沒辦法（DELETE 限群主）。
--
--    修法：UPDATE 補 WITH CHECK「群主 OR user_id = 自己 OR user_id IS NULL」。
--    user_id IS NULL 只會是解除連結：USING 已限定只能動自己那列或自己當群主的群組，
--    trigger 又鎖死 group_id 與 user_id 的變更方式。
--    前端同步加上「離開群組」（ManageMembersModal，自己那列、非群主才有）。
--
-- 對正常流程的影響（已逐一確認）：
--   - 前端／CLI 新增成員寫 user_id = NULL → 符合 a)
--   - create_split_group（SECURITY INVOKER）寫的是建立者自己 → 符合 a)
--   - join_split_group_as_new_member / link_self_to_split_member 為 SECURITY DEFINER，
--     以函式擁有者身分執行、不受 RLS 影響；link 會觸發 trigger，走的是「認領空位」分支
--   - 前端沒有「群主把成員連到某個帳號」的功能，b) 不會擋到任何既有操作
--
-- 對應的正式定義已同步更新於 database/split-migration.sql
--
-- -----------------------------------------------------------------------------
-- 部署順序：先跑本腳本，再 release 前端（「離開群組」按鈕要靠 ② 的 WITH CHECK 才會成功）。
--           不需要重新部署 Edge Functions，CLI 不受影響。
-- -----------------------------------------------------------------------------

BEGIN;

-- =============================================================================
-- 1. INSERT：新增的列只能是空位或自己
-- =============================================================================
DROP POLICY IF EXISTS "split_members_insert" ON split_members;
CREATE POLICY "split_members_insert" ON split_members
  FOR INSERT WITH CHECK (
    can_access_split_group(group_id, auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- =============================================================================
-- 2. UPDATE：補 WITH CHECK，讓本人能把自己那列的 user_id 改成 NULL
-- =============================================================================
DROP POLICY IF EXISTS "split_members_update" ON split_members;
CREATE POLICY "split_members_update" ON split_members
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM split_groups WHERE id = group_id AND owner_id = auth.uid())
    OR user_id = auth.uid()
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM split_groups WHERE id = group_id AND owner_id = auth.uid())
    OR user_id = auth.uid()
    OR user_id IS NULL
  );

-- =============================================================================
-- 3. trigger：群主只能解除連結，不能把成員連到別的帳號
-- =============================================================================
-- auth.uid() IS NULL 放行的理由不變：那是 service_role 或 SQL Editor 直連（本就有完整
-- 權限），擋它只會讓日後無法用 SQL 修資料；anon 走不到這裡，已被 USING 擋下。
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
       (NEW.user_id IS NULL
        AND EXISTS (SELECT 1 FROM split_groups WHERE id = OLD.group_id AND owner_id = auth.uid()))
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

COMMIT;

-- =============================================================================
-- 驗證（單一查詢；SQL Editor 只顯示最後一句的輸出）
-- 預期：每一列的「結果」都等於「預期」
-- =============================================================================
SELECT * FROM (
  SELECT 1 AS 序, 'INSERT policy 的 WITH CHECK 有限制 user_id' AS 檢查項目,
    (SELECT (with_check LIKE '%can_access_split_group%'
             AND with_check LIKE '%user_id IS NULL%'
             AND with_check LIKE '%user_id = auth.uid()%')::text
       FROM pg_policies
      WHERE tablename = 'split_members' AND policyname = 'split_members_insert') AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, 'INSERT policy 沒有頂層 OR 側門',
    (SELECT (with_check NOT LIKE '%auth.uid()) OR (user_id = auth.uid())%')::text
       FROM pg_policies
      WHERE tablename = 'split_members' AND policyname = 'split_members_insert'),
    'true'
  UNION ALL SELECT 3, 'UPDATE policy 有 WITH CHECK 且允許 user_id IS NULL',
    (SELECT (with_check IS NOT NULL AND with_check LIKE '%user_id IS NULL%')::text
       FROM pg_policies
      WHERE tablename = 'split_members' AND policyname = 'split_members_update'),
    'true'
  UNION ALL SELECT 4, 'trigger 函式的群主分支只允許解除連結',
    (SELECT (pg_get_functiondef(oid) LIKE '%(NEW.user_id IS NULL%AND EXISTS%owner_id = auth.uid()%')::text
       FROM pg_proc
      WHERE proname = 'protect_split_member_identity' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 5, 'protect_split_member_identity trigger 啟用中',
    (SELECT tgenabled::text FROM pg_trigger
      WHERE tgrelid = 'split_members'::regclass AND tgname = 'protect_split_member_identity'),
    'O'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 建立新分帳群組（含額外成員）→ 成功、自己標示為已連結
--   2) 對既有群組新增成員 → 成功
--   3) 用邀請碼加入群組（另一個帳號）→ 成功
--   4) 連結到既有的空成員位置 → 成功（驗 trigger 的認領空位分支）
--   5) 非群主帳號在「管理成員」按自己那列的「離開群組」→ 回到群組列表、該群組消失；
--      群主那邊看到該成員變成未連結，帳目不變
--   6) 修改自己的名字、群主修改未連結成員的名字 → 成功
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在上述實測失敗時使用）
-- =============================================================================
-- 第 1 段還原（⚠️ 會重新打開「把別人塞進群組」的洞）：
--   DROP POLICY IF EXISTS "split_members_insert" ON split_members;
--   CREATE POLICY "split_members_insert" ON split_members
--     FOR INSERT WITH CHECK (can_access_split_group(group_id, auth.uid()));
--
-- 第 2 段還原（非群主會再度無法離開群組）：
--   DROP POLICY IF EXISTS "split_members_update" ON split_members;
--   CREATE POLICY "split_members_update" ON split_members
--     FOR UPDATE USING (
--       EXISTS (SELECT 1 FROM split_groups WHERE id = group_id AND owner_id = auth.uid())
--       OR user_id = auth.uid()
--     );
--
-- 第 3 段還原：把群主分支改回
--   EXISTS (SELECT 1 FROM split_groups WHERE id = OLD.group_id AND owner_id = auth.uid())
--   其餘照 scripts/fix-split-member-access.sql 第 2 段原樣重建。
-- =============================================================================
