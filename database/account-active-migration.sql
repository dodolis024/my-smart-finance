-- ============================================
-- 帳戶停用（剪卡、關戶後保留歷史）
-- 在 Supabase SQL Editor 手動執行
-- ============================================
--
-- 刪除帳戶會被「仍有交易」擋下，但剪掉的卡本來就不該刪：它的消費記錄不屬於別的帳戶，
-- 硬搬只會弄髒歷史。改成「停用」：帳戶留著、交易與統計全部保留，只是不再出現在
-- 記帳表單、訂閱、餘額面板這些之後還會用到帳戶的地方，隨時可以重新啟用。
--
-- 預設 TRUE：既有帳戶不用回填，加欄位前後行為完全相同。
--
-- ⚠️ 必須先於前端上線執行：新版設定頁按「停用」會寫 is_active，欄位不存在會失敗。
--    send-credit-card-reminder 邊緣函式的新版也會以 is_active 過濾，同樣要在這支跑完之後才部署。
--    CLI 1.4.0 的 listAccounts 會 select is_active，同理要在這支跑完之後才 npm publish。

-- 1. accounts 加啟用欄位
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN accounts.is_active IS '停用（剪卡、關戶）後為 FALSE：歷史交易保留，但不再出現在記帳表單、訂閱與餘額面板';

-- 2. get_dashboard_data 逐欄列出帳戶欄位，不更新的話前端拿不到啟用狀態（會一律當啟用）
--    以 database/supabase-functions.sql 的現行定義為底稿，只多一個 isActive
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
            'overseasFeeAutoCheck', overseas_fee_auto_check,
            'isActive', is_active
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
    WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'is_active'
  ) AS column_added,
  position('isActive' IN pg_get_functiondef('public.get_dashboard_data(text, integer, integer)'::regprocedure)) > 0
    AS rpc_returns_active;
