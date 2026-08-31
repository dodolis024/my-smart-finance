-- =============================================================================
-- Smart Finance Tracker - 分帳頭像 RPC 收斂（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-08-31 資安健檢的後續檢查。頭像這條路的保密性沒有問題
-- （batch 版逐列過 can_access_split_group，且只取 avatar_url / picture 兩個欄位，
--  不會把 raw_user_meta_data 裡的 email、full_name、Google sub 帶出來），
-- 但有兩處可以收斂：
--
-- ① 移除死碼 get_split_member_avatars(UUID)
--    前端自 scripts/fix-query-optimization.sql 改用批次版之後，這支就沒有任何
--    呼叫端（已確認 src/、tools/、tests/ 全域無引用）。它是 SECURITY DEFINER
--    且會讀 auth.users，留著只是多一個攻擊面。
--
--    ⚠️ 副作用：scripts/fix-security-hardening.sql:64 有一行
--       ALTER FUNCTION get_split_member_avatars(UUID) SET search_path = public;
--       那是歷史性的一次性腳本，執行本腳本後若再重跑它會報錯。正常情況不會
--       重跑，若需重建資料庫請以 database/*.sql 為準。
--
-- ② get_split_member_avatars_batch 的 p_group_ids 加上大小上限
--    原本無上限，可一次帶入任意數量的 UUID。不會外洩（每列都過存取檢查），
--    但屬於資源濫用面。前端實際只會帶入自己看得到的群組，200 綽綽有餘。
--
--    SPLIT_TOO_MANY_GROUPS 刻意不加進 src/lib/splitErrors.js 的
--    KNOWN_ERROR_CODES：這是防呆用的開發者訊號，正常使用者不該遇到；
--    真的遇到時 resolveRpcError 會回 null，前端顯示通用 fallback 文案，
--    不會把原始錯誤字串曝給使用者。
--
-- 對應的正式定義已同步更新於 database/split-migration.sql
--
-- 部署順序：僅需執行本腳本。前端另有一處錯誤處理修正（見下方「前端配套」），
--           兩者互相獨立，先後順序不拘。
--
-- 前端配套（src/hooks/useSplitGroups.js）：
--   批次 RPC 原本以 const { data: avatars } = ... 取值，error 未解構也未檢查。
--   RPC 失敗時 avatarMap 為空，所有頭像靜默退化成首字母，畫面與「大家本來就
--   沒設頭像」完全相同，無從查起。已補上 console.warn。
-- =============================================================================

-- =============================================================================
-- 1. 移除單筆版死碼
-- =============================================================================
DROP FUNCTION IF EXISTS get_split_member_avatars(UUID);

-- =============================================================================
-- 2. 批次版加上輸入上限
-- =============================================================================
CREATE OR REPLACE FUNCTION get_split_member_avatars_batch(p_group_ids UUID[])
RETURNS JSON AS $$
BEGIN
  IF p_group_ids IS NULL OR array_length(p_group_ids, 1) IS NULL THEN
    RETURN '[]'::json;
  END IF;
  IF array_length(p_group_ids, 1) > 200 THEN
    RAISE EXCEPTION 'SPLIT_TOO_MANY_GROUPS';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'group_id',   sm.group_id,
      'member_id',  sm.id,
      'avatar_url', COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
    )), '[]'::json)
    FROM split_members sm
    JOIN auth.users u ON u.id = sm.user_id
    WHERE sm.group_id = ANY(p_group_ids)
      AND sm.user_id IS NOT NULL
      -- owner 或成員才可讀
      AND can_access_split_group(sm.group_id, auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================================================
-- 3. 驗證
-- =============================================================================
-- 3a. 單筆版應已不存在（回 0 筆），批次版仍在（回 1 筆）
SELECT p.proname AS "函式", pg_get_function_identity_arguments(p.oid) AS "參數"
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname LIKE 'get_split_member_avatars%';

-- 3b. 空陣列 / NULL 應回 []
SELECT get_split_member_avatars_batch(ARRAY[]::UUID[]) AS "空陣列",
       get_split_member_avatars_batch(NULL)            AS "NULL";

-- 3c. 超量應報 SPLIT_TOO_MANY_GROUPS（預期會噴錯，這是正確結果）
--   SELECT get_split_member_avatars_batch(
--     ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201))
--   );

-- -----------------------------------------------------------------------------
-- 執行後實測：開啟分帳列表頁 → 已連結 Google 帳號的成員仍應顯示頭像
-- （若頭像消失，開 DevTools Console 看有沒有 [useSplitGroups] 取得成員頭像失敗）
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback
-- =============================================================================
-- 第 2 段還原：把上方 CREATE OR REPLACE 的兩段 IF 拿掉即可。
-- 第 1 段還原：單筆版定義見 git 歷史
--   git show HEAD:database/split-migration.sql（2026-08-31 之前的版本）
--   實務上不需要——前端沒有呼叫端。
-- =============================================================================
