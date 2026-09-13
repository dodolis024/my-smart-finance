-- ============================================
-- 海外交易手續費（信用卡、簽帳金融卡）
-- 在 Supabase SQL Editor 手動執行
-- ============================================
--
-- 用台灣發行的卡刷外幣時，銀行會另收一筆國外交易手續費（多數約 1.5%，每張卡不同）。
-- 每個帳戶自己設定費率，記帳時使用者勾「海外消費」，手續費併入同一筆交易：
-- twd_amount = 台幣本體 + 手續費。全站統計都是加總 twd_amount，所以自動計入，
-- 另存 overseas_fee / overseas_fee_rate 只是讓詳細頁拆得出本體與手續費。
--
-- ⚠️ 必須先於前端與 CLI 上線執行，否則寫入新欄位會失敗（column does not exist）。

-- 1. accounts：每個帳戶自己的海外手續費率與預設勾選開關
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS overseas_fee_rate NUMERIC(5, 3)
    CHECK (overseas_fee_rate IS NULL OR (overseas_fee_rate > 0 AND overseas_fee_rate <= 10));

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS overseas_fee_auto_check BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN accounts.overseas_fee_rate IS '海外交易手續費率（百分比，1.5 = 1.5%）；NULL 表示此帳戶不收或未設定。僅信用卡與簽帳金融卡使用';
COMMENT ON COLUMN accounts.overseas_fee_auto_check IS '記帳選外幣時是否預設勾選「海外消費」；只在 overseas_fee_rate 有值時有意義';

-- 2. transactions：手續費併入 twd_amount，另存明細供詳細頁拆分顯示
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS overseas_fee_rate NUMERIC(5, 3);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS overseas_fee NUMERIC(10, 2);

-- 兩欄必須同時有值或同時為 NULL，避免半套資料
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_overseas_fee_pair;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_overseas_fee_pair CHECK (
    (overseas_fee_rate IS NULL AND overseas_fee IS NULL)
    OR (overseas_fee_rate > 0 AND overseas_fee >= 0)
  );

COMMENT ON COLUMN transactions.overseas_fee_rate IS '記帳當時套用的海外手續費率（%）；NULL = 非海外消費';
COMMENT ON COLUMN transactions.overseas_fee IS '海外手續費台幣金額，已包含在 twd_amount 內（twd_amount = 本體 + 手續費）';

-- 3. get_dashboard_data 逐欄列出交易與帳戶欄位，不更新的話前端拿不到手續費欄位
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
