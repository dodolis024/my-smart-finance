-- =============================================================================
-- Smart Finance Tracker - 安全加固（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 修正三個問題：
-- 1. calculate_streak_stats / create_default_* 為 SECURITY DEFINER 且接受
--    p_user_id 參數，任何登入者都可以直接以他人的 user_id 呼叫（洩漏簽到記錄、
--    塞入預設資料）→ 收回直接執行權
-- 2. split_groups 的 UPDATE policy 沒有限制可更新的欄位，任何成員都能把
--    owner_id 改成自己（奪走群組擁有權）→ 以 trigger 保護 owner_id / invite_code
-- 3. SECURITY DEFINER 函數未固定 search_path（Supabase linter 警告）→ 全部補上
--
-- 對應的正式定義已同步更新於 database/*.sql
-- =============================================================================

-- =============================================================================
-- 1. 收回可指定 p_user_id 的 SECURITY DEFINER 函數的直接執行權
-- =============================================================================
-- calculate_streak_stats 只被 get_dashboard_data 內部呼叫（以函數擁有者身分執行，
-- 不受 REVOKE 影響）；create_default_accounts / create_default_settings 未被程式
-- 使用（前端以 createDefaultData 建立預設資料）
REVOKE EXECUTE ON FUNCTION calculate_streak_stats(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_default_accounts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_default_settings(UUID) FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 2. 防止非擁有者竄改 owner_id / invite_code
-- =============================================================================
-- RLS 的 WITH CHECK 無法比較新舊值，需用 trigger 保護欄位
CREATE OR REPLACE FUNCTION protect_split_group_ownership()
RETURNS TRIGGER
SET search_path = public
AS $$
BEGIN
  IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.invite_code IS DISTINCT FROM OLD.invite_code)
     AND (auth.uid() IS NULL OR auth.uid() <> OLD.owner_id) THEN
    RAISE EXCEPTION '只有群組擁有者可以變更擁有權或邀請碼';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_split_group_ownership ON split_groups;
CREATE TRIGGER protect_split_group_ownership
  BEFORE UPDATE ON split_groups
  FOR EACH ROW
  EXECUTE FUNCTION protect_split_group_ownership();

-- =============================================================================
-- 3. 固定所有 SECURITY DEFINER 函數的 search_path
-- =============================================================================
ALTER FUNCTION get_dashboard_data(TEXT, INTEGER, INTEGER) SET search_path = public;
ALTER FUNCTION calculate_streak_stats(UUID, TEXT) SET search_path = public;
ALTER FUNCTION get_available_currencies() SET search_path = public;
ALTER FUNCTION get_exchange_rate(TEXT) SET search_path = public;
ALTER FUNCTION get_yearly_review(INTEGER) SET search_path = public;
ALTER FUNCTION create_default_accounts(UUID) SET search_path = public;
ALTER FUNCTION create_default_settings(UUID) SET search_path = public;
ALTER FUNCTION get_user_split_group_ids(UUID) SET search_path = public;
ALTER FUNCTION can_access_split_group(UUID, UUID) SET search_path = public;
ALTER FUNCTION get_group_by_invite_code(TEXT) SET search_path = public;
ALTER FUNCTION get_split_member_avatars(UUID) SET search_path = public;
ALTER FUNCTION link_self_to_split_member(UUID) SET search_path = public;
ALTER FUNCTION join_split_group_as_new_member(TEXT, TEXT) SET search_path = public;
ALTER FUNCTION get_split_sync_status(UUID) SET search_path = public;
ALTER FUNCTION sync_split_to_ledger(UUID, TEXT, UUID) SET search_path = public;

-- =============================================================================
-- 驗證（可選）：確認 search_path 已套用、trigger 已建立
-- =============================================================================
-- SELECT proname, proconfig FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace AND prosecdef = true;
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'split_groups'::regclass;
