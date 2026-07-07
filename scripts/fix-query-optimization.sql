-- =============================================================================
-- Smart Finance Tracker - 查詢效能優化（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 三項優化（正式定義已同步更新於 database/）：
-- 1. 頭像批次 RPC：前端原本逐群組呼叫 get_split_member_avatars(N 次往返)，
--    新增 get_split_member_avatars_batch 一次撈回所有群組成員頭像
--    （正式定義：database/split-migration.sql）
-- 2. get_dashboard_data（月）：WHERE 由 EXTRACT(YEAR/MONTH FROM date) 改為
--    date >= X AND date < Y 範圍條件，讓 idx_transactions_user_id_date 生效
-- 3. get_yearly_review（年）：同上，年度/去年同期改用範圍條件
--    （2、3 正式定義：database/supabase-functions.sql）
--
-- 注意：第 1 項的 RPC 必須先於新版前端部署（前端會改呼叫此 RPC，否則 404）
-- 語意等價：範圍為半開區間 [當期第一天, 下一期第一天)，結果與原本逐年/月相同
-- =============================================================================


-- =============================================================================
-- 1. 批次取得多個群組成員的頭像（避免前端逐群組 N 次 RPC）
-- =============================================================================
CREATE OR REPLACE FUNCTION get_split_member_avatars_batch(p_group_ids UUID[])
RETURNS JSON AS $$
BEGIN
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
      -- 沿用單筆版的存取語意：owner 或成員才可讀
      AND can_access_split_group(sm.group_id, auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;


-- =============================================================================
-- 2. get_dashboard_data（月）：EXTRACT → date 範圍查詢
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
            'paymentDueDay', payment_due_day,
            'currentBalanceFormula', current_balance_formula
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
-- 3. get_yearly_review（年）：EXTRACT → date 範圍查詢
-- =============================================================================
DROP FUNCTION IF EXISTS get_yearly_review(INTEGER);

CREATE OR REPLACE FUNCTION get_yearly_review(p_year INTEGER)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_annual_totals JSON;
    v_monthly_breakdown JSON;
    v_top_categories JSON;
    v_checkin_days INTEGER;
    v_top_expenses JSON;
    v_prev_totals JSON;
    v_result JSON;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'User not authenticated');
    END IF;

    -- 年度總計
    SELECT json_build_object(
        'totalIncome',       COALESCE(SUM(CASE WHEN type = 'income'  THEN twd_amount ELSE 0 END), 0),
        'totalExpense',      COALESCE(SUM(CASE WHEN type = 'expense' THEN twd_amount ELSE 0 END), 0),
        'balance',           COALESCE(SUM(CASE WHEN type = 'income'  THEN twd_amount ELSE -twd_amount END), 0),
        'transactionCount',  COUNT(*),
        'expenseCount',      COUNT(*) FILTER (WHERE type = 'expense')
    ) INTO v_annual_totals
    FROM transactions
    WHERE user_id = v_user_id
        AND date >= make_date(p_year, 1, 1) AND date < make_date(p_year + 1, 1, 1);

    -- 12 個月明細（無資料的月份補 0）
    SELECT json_agg(
        json_build_object(
            'month',   m.month,
            'income',  COALESCE(t.income,  0),
            'expense', COALESCE(t.expense, 0),
            'balance', COALESCE(t.income, 0) - COALESCE(t.expense, 0)
        ) ORDER BY m.month
    )
    INTO v_monthly_breakdown
    FROM generate_series(1, 12) AS m(month)
    LEFT JOIN (
        SELECT
            EXTRACT(MONTH FROM date)::INT AS month,
            SUM(CASE WHEN type = 'income'  THEN twd_amount ELSE 0 END) AS income,
            SUM(CASE WHEN type = 'expense' THEN twd_amount ELSE 0 END) AS expense
        FROM transactions
        WHERE user_id = v_user_id
            AND date >= make_date(p_year, 1, 1) AND date < make_date(p_year + 1, 1, 1)
        GROUP BY EXTRACT(MONTH FROM date)
    ) t ON m.month = t.month;

    -- 支出類別排行（Top 5）
    SELECT json_agg(
        json_build_object(
            'category',   category,
            'amount',     total,
            'percentage', ROUND((total / NULLIF(grand_total, 0)) * 100, 1)
        )
    )
    INTO v_top_categories
    FROM (
        SELECT
            category,
            SUM(twd_amount)              AS total,
            SUM(SUM(twd_amount)) OVER () AS grand_total
        FROM transactions
        WHERE user_id = v_user_id
            AND date >= make_date(p_year, 1, 1) AND date < make_date(p_year + 1, 1, 1)
            AND type = 'expense'
        GROUP BY category
        ORDER BY SUM(twd_amount) DESC
        LIMIT 5
    ) ranked;

    -- 該年簽到天數
    SELECT COUNT(DISTINCT date)::INT
    INTO v_checkin_days
    FROM checkins
    WHERE user_id = v_user_id
        AND date >= make_date(p_year, 1, 1) AND date < make_date(p_year + 1, 1, 1);

    -- 金額最高的三筆支出
    SELECT json_agg(
        json_build_object(
            'itemName', item_name,
            'category', category,
            'amount',   twd_amount,
            'date',     date
        ) ORDER BY twd_amount DESC
    )
    INTO v_top_expenses
    FROM (
        SELECT item_name, category, twd_amount, date
        FROM transactions
        WHERE user_id = v_user_id
            AND date >= make_date(p_year, 1, 1) AND date < make_date(p_year + 1, 1, 1)
            AND type = 'expense'
        ORDER BY twd_amount DESC
        LIMIT 3
    ) top3;

    -- 去年同期彙總（年度對比用；transactionCount = 0 代表去年無資料，前端據此隱藏對比）
    SELECT json_build_object(
        'totalIncome',      COALESCE(SUM(CASE WHEN type = 'income'  THEN twd_amount ELSE 0 END), 0),
        'totalExpense',     COALESCE(SUM(CASE WHEN type = 'expense' THEN twd_amount ELSE 0 END), 0),
        'balance',          COALESCE(SUM(CASE WHEN type = 'income'  THEN twd_amount ELSE -twd_amount END), 0),
        'transactionCount', COUNT(*)
    ) INTO v_prev_totals
    FROM transactions
    WHERE user_id = v_user_id
        AND date >= make_date(p_year - 1, 1, 1) AND date < make_date(p_year, 1, 1);

    RETURN json_build_object(
        'success',          true,
        'annualTotals',     COALESCE(v_annual_totals, json_build_object(
                                'totalIncome', 0, 'totalExpense', 0, 'balance', 0, 'transactionCount', 0, 'expenseCount', 0)),
        'previousTotals',   COALESCE(v_prev_totals, json_build_object(
                                'totalIncome', 0, 'totalExpense', 0, 'balance', 0, 'transactionCount', 0)),
        'monthlyBreakdown', COALESCE(v_monthly_breakdown, '[]'::json),
        'topCategories',    COALESCE(v_top_categories, '[]'::json),
        'topExpenses',      COALESCE(v_top_expenses, '[]'::json),
        'highlights',       json_build_object(
                                'checkinDays',  COALESCE(v_checkin_days, 0)
                            )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 完成！部署順序：
--   1) 執行本腳本（建立 batch RPC + 重定義 dashboard/yearly 函式）
--   2) 部署新版前端（useSplitGroups 改呼叫 get_split_member_avatars_batch）
-- =============================================================================
