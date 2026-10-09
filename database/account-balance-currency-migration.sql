-- ============================================
-- 帳戶餘額的幣別（現金錢包等非信用卡帳戶）
-- 在 Supabase SQL Editor 手動執行
-- ============================================
--
-- 原本餘額只有一個數字、沒有幣別，一律當台幣扣：在英國用英鎊現金，填了 100 鎊，
-- 花 5 鎊卻扣掉約 200（換算後的台幣）。加上幣別後，每筆交易先換成帳戶的幣別再扣：
--   - 交易幣別與帳戶相同 → 用這筆記帳時凍結的匯率還原原幣
--   - 不同（例如拿台幣現金付英鎊的帳）→ 依交易當天的歷史匯率換算
-- 換算在前端（src/lib/accountBalance.js），這裡只存幣別。
--
-- NULL 表示台幣：既有帳戶不用回填，行為與加入這個欄位之前完全相同。
--
-- ⚠️ 必須先於前端上線執行：新版設定頁存帳戶時會寫入 balance_currency，
--    欄位不存在會整筆存檔失敗（column does not exist）。

-- 1. accounts 加幣別欄位
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS balance_currency TEXT
    CHECK (balance_currency IS NULL OR balance_currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN accounts.balance_currency IS 'balance_amount 的幣別（ISO 4217）；NULL 表示台幣';

-- 2. get_dashboard_data 逐欄列出帳戶欄位，不更新的話前端拿不到幣別
--    以 database/supabase-functions.sql 的現行定義為底稿，只多一個 balanceCurrency
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
            'time', t.time,
            'itemName', t.item_name,
            'category', t.category,
            'paymentMethod', t.payment_method,
            'currency', t.currency,
            'originalAmount', t.amount,
            'exchangeRate', t.exchange_rate,
            'twdAmount', t.twd_amount,
            'overseasFeeRate', t.overseas_fee_rate,
            'overseasFee', t.overseas_fee,
            'note', t.note,
            'type', t.type,
            'isSplitSynced', EXISTS (
                SELECT 1 FROM split_ledger_syncs s WHERE s.transaction_id = t.id
            )
        ) ORDER BY t.date DESC, t.time DESC, t.created_at DESC
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
            'balanceAmount', balance_amount,
            'balanceAsOf', balance_as_of,
            'balanceCurrency', balance_currency,
            'overseasFeeRate', overseas_fee_rate,
            'overseasFeeAutoCheck', overseas_fee_auto_check
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


-- 3. 驗證（單一 SELECT，SQL Editor 只顯示最後一段結果）：兩欄皆應為 true
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'balance_currency'
  ) AS column_added,
  position('balance_currency' IN pg_get_functiondef('public.get_dashboard_data(text, integer, integer)'::regprocedure)) > 0
    AS rpc_returns_currency;
