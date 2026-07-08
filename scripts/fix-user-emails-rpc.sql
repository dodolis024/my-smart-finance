-- =============================================================================
-- Smart Finance Tracker - get_user_emails RPC（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：新版 send-streak-reminder edge function 改用此 RPC 批次取得用戶 email
-- （取代逐用戶 auth.admin.getUserById）。此函式先前只更新在正式定義檔
-- database/supabase-functions.sql，漏建對應的部署腳本——若生產環境缺這個 RPC，
-- 新版 edge function 每次執行都會失敗，簽到提醒 email 會全面停止寄送。
--
-- 部署順序：先執行本腳本，再 supabase functions deploy send-streak-reminder
-- =============================================================================

-- 批次取得多個用戶的 email
-- 參數：p_user_ids UUID[]
-- 回傳：JSON 陣列，每筆 { id, email }
-- 安全性：回傳 auth.users 的 email，屬敏感資料；REVOKE 掉所有客戶端權限，
--         僅 service-role（edge function）可呼叫。
CREATE OR REPLACE FUNCTION get_user_emails(p_user_ids UUID[])
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(json_build_object('id', u.id, 'email', u.email)), '[]'::json)
    FROM auth.users u
    WHERE u.id = ANY(p_user_ids)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

REVOKE EXECUTE ON FUNCTION get_user_emails(UUID[]) FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 部署後驗證（重要）
-- =============================================================================
-- 1. service_role 仍可執行（Supabase 預設 default privileges 會給 service_role
--    明確授權，REVOKE PUBLIC/anon/authenticated 不影響它；以下查詢應包含
--    service_role=X 的授權記錄）：
--
--    SELECT grantee, privilege_type
--    FROM information_schema.routine_privileges
--    WHERE routine_name = 'get_user_emails';
--
--    若結果中沒有 service_role，補上：
--    GRANT EXECUTE ON FUNCTION get_user_emails(UUID[]) TO service_role;
--
-- 2. 實測 edge function：部署後於 Dashboard > Edge Functions 手動 invoke
--    send-streak-reminder，回應應為 success:true 而非 permission denied。
--
-- 3. 客戶端確實被擋：登入一般帳號後在瀏覽器 console 執行
--    supabase.rpc('get_user_emails', { p_user_ids: ['<任一uuid>'] })
--    應回傳 permission denied for function get_user_emails。
-- =============================================================================
