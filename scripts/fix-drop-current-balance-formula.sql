-- =============================================================================
-- Smart Finance Tracker - 移除 accounts.current_balance_formula 死欄位（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：current_balance_formula 自始未被前端讀寫，get_dashboard_data 仍多回傳
--       一個沒人用的 currentBalanceFormula key。此腳本移除該欄位與 RPC 引用。
--       （正式定義已同步更新於 database/supabase-migration.sql 與
--         database/supabase-functions.sql）
--
-- 順序不可反：必須先 CREATE OR REPLACE 讓 RPC 不再引用該欄位，
--             再 DROP COLUMN，否則 DROP 會因函式相依而受阻或留下壞函式。
-- 此腳本不需 deploy 任何 edge function。
-- =============================================================================


-- =============================================================================
-- 1. get_dashboard_data：從 accounts JSON 移除 currentBalanceFormula
--    （其餘與現行部署版完全相同；保留 SECURITY DEFINER 與 search_path）
-- =============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_data(
    p_client_today TEXT DEFAULT NULL,
    p_month INTEGER DEFAULT NULL,
    p_year INTEGER DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_summary JSON;
    v_history JSON;
    v_accounts JSON;
    v_categories JSONB;
    v_expense_categories JSONB;
    v_income_categories JSONB;
    v_streak_count INTEGER;
    v_streak_broken BOOLEAN;
    v_total_logged_days INTEGER;
    v_longest_streak INTEGER;
    v_logged_dates JSON;
    v_result JSON;
BEGIN
    -- 取得目前使用者 ID
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'User not authenticated');
    END IF;

    -- 驗證年月參數
    IF p_year IS NULL OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
        RETURN json_build_object('success', false, 'error', 'Invalid year or month');
    END IF;

    -- 計算摘要（收入、支出、餘額）
    SELECT json_build_object(
        'totalIncome', COALESCE(SUM(CASE WHEN type = 'income' THEN twd_amount ELSE 0 END), 0),
        'totalExpense', COALESCE(SUM(CASE WHEN type = 'expense' THEN twd_amount ELSE 0 END), 0),
        'balance', COALESCE(SUM(CASE WHEN type = 'income' THEN twd_amount ELSE -twd_amount END), 0)
    ) INTO v_summary
    FROM transactions
    WHERE user_id = v_user_id
        AND date >= make_date(p_year, p_month, 1)
        AND date < (make_date(p_year, p_month, 1) + INTERVAL '1 month')::date;

    -- 取得交易紀錄（該年月的所有交易）
    -- isSplitSynced：是否存在 split_ledger_syncs 關聯（分帳同步至個人帳本），不依賴類別文字
    SELECT json_agg(
        json_build_object(
            'id', t.id,
            'date', t.date,
            'itemName', t.item_name,
            'category', t.category,
            'paymentMethod', t.payment_method,
            'currency', t.currency,
            'originalAmount', t.amount,
            'exchangeRate', t.exchange_rate,
            'twdAmount', t.twd_amount,
            'note', t.note,
            'type', t.type,
            'isSplitSynced', EXISTS (
                SELECT 1 FROM split_ledger_syncs s WHERE s.transaction_id = t.id
            )
        ) ORDER BY t.date DESC, t.created_at DESC
    ) INTO v_history
    FROM transactions t
    WHERE t.user_id = v_user_id
        AND t.date >= make_date(p_year, p_month, 1)
        AND t.date < (make_date(p_year, p_month, 1) + INTERVAL '1 month')::date;

    -- 取得帳戶列表
    SELECT json_agg(
        json_build_object(
            'id', id,
            'accountName', name,
            'type', type,
            'creditLimit', credit_limit,
            'billingDay', billing_day,
            'paymentDueDay', payment_due_day
        ) ORDER BY created_at ASC
    ) INTO v_accounts
    FROM accounts
    WHERE user_id = v_user_id;

    -- 取得類別設定
    SELECT value INTO v_expense_categories
    FROM settings
    WHERE user_id = v_user_id AND key = 'expense_categories';

    SELECT value INTO v_income_categories
    FROM settings
    WHERE user_id = v_user_id AND key = 'income_categories';

    -- 如果沒有設定，使用預設值
    IF v_expense_categories IS NULL THEN
        v_expense_categories := '["飲食", "飲料", "交通", "旅遊", "娛樂", "購物", "其他"]'::jsonb;
    END IF;

    IF v_income_categories IS NULL THEN
        v_income_categories := '["薪水", "投資", "其他"]'::jsonb;
    END IF;

    -- 合併類別列表
    v_categories := v_expense_categories || v_income_categories;

    -- 計算 streak 相關資料（呼叫專門的函數，傳入客戶端的今天日期）
    SELECT
        streak_count,
        streak_broken,
        total_logged_days,
        longest_streak,
        logged_dates
    INTO
        v_streak_count,
        v_streak_broken,
        v_total_logged_days,
        v_longest_streak,
        v_logged_dates
    FROM calculate_streak_stats(v_user_id, p_client_today);

    -- 組合結果
    v_result := json_build_object(
        'success', true,
        'summary', v_summary,
        'history', COALESCE(v_history, '[]'::json),
        'accounts', COALESCE(v_accounts, '[]'::json),
        'categories', v_categories,
        'categoriesExpense', v_expense_categories,
        'categoriesIncome', v_income_categories,
        'streakCount', v_streak_count,
        'streakBroken', v_streak_broken,
        'totalLoggedDays', v_total_logged_days,
        'longestStreak', v_longest_streak,
        'loggedDates', COALESCE(v_logged_dates, '[]'::json)
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- =============================================================================
-- 2. 移除死欄位（在 RPC 不再引用之後才可執行；此步不可逆）
-- =============================================================================
ALTER TABLE accounts DROP COLUMN IF EXISTS current_balance_formula;


-- =============================================================================
-- 3. 部署後驗證（可選；預期結果如註解）
-- =============================================================================
-- (a) 欄位應已消失：以下查詢應回傳 0 列
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'accounts' AND column_name = 'current_balance_formula';
--
-- (b) RPC 應正常回傳、且 accounts 內不再含 currentBalanceFormula key
-- SELECT get_dashboard_data(NULL, EXTRACT(MONTH FROM now())::int, EXTRACT(YEAR FROM now())::int);
