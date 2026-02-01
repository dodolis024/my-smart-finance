-- =============================================================================
-- Supabase Database Functions
-- 用於處理複雜的業務邏輯（如 streak 計算、儀表板資料聚合）
-- =============================================================================
-- 
-- 使用說明：
-- 在 Supabase Dashboard > SQL Editor 中執行此腳本
-- 這些函數會被前端透過 Supabase Client 呼叫
-- 
-- =============================================================================

-- =============================================================================
-- 0. 依賴：exchange_rates 表（若尚未建立，先建立表與 RLS，函數才可正常執行）
-- =============================================================================
CREATE TABLE IF NOT EXISTS exchange_rates (
    currency_code TEXT PRIMARY KEY,
    rate NUMERIC(10, 6) NOT NULL DEFAULT 1.0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read exchange_rates" ON exchange_rates;
CREATE POLICY "Authenticated users can read exchange_rates"
    ON exchange_rates FOR SELECT
    TO authenticated
    USING (true);

INSERT INTO exchange_rates (currency_code, rate)
VALUES ('TWD', 1.0), ('USD', 30.0), ('JPY', 0.2), ('EUR', 32.0), ('GBP', 38.0)
ON CONFLICT (currency_code) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW();

-- =============================================================================
-- 1. 取得儀表板資料（getDashboardData）
-- =============================================================================
-- 功能：回傳指定年月的摘要、交易紀錄、帳戶列表、類別列表、streak 資訊
-- 參數：p_month (INTEGER), p_year (INTEGER)
-- 注意：參數順序必須與 PostgREST 預期一致（依字母順序），否則會 404
-- 回傳：JSON 物件
-- 若曾建立過舊版（參數名不同），需先 DROP 再建立
DROP FUNCTION IF EXISTS get_dashboard_data(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_dashboard_data(p_month INTEGER, p_year INTEGER)
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
        AND EXTRACT(YEAR FROM date) = p_year
        AND EXTRACT(MONTH FROM date) = p_month;

    -- 取得交易紀錄（該年月的所有交易）
    SELECT json_agg(
        json_build_object(
            'id', id,
            'date', date,
            'itemName', item_name,
            'category', category,
            'paymentMethod', payment_method,
            'currency', currency,
            'originalAmount', amount,
            'exchangeRate', exchange_rate,
            'twdAmount', twd_amount,
            'note', note,
            'type', type
        ) ORDER BY date DESC, created_at DESC
    ) INTO v_history
    FROM transactions
    WHERE user_id = v_user_id
        AND EXTRACT(YEAR FROM date) = p_year
        AND EXTRACT(MONTH FROM date) = p_month;

    -- 取得帳戶列表
    SELECT json_agg(
        json_build_object(
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

    -- 計算 streak 相關資料（呼叫專門的函數）
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
    FROM calculate_streak_stats(v_user_id);

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. 計算 Streak 統計資料
-- =============================================================================
-- 功能：計算連續記帳天數、總記帳天數、最長連續記帳等
-- 參數：p_user_id UUID
-- 回傳：TABLE (streak_count, streak_broken, total_logged_days, longest_streak, logged_dates)
DROP FUNCTION IF EXISTS calculate_streak_stats(UUID);

CREATE OR REPLACE FUNCTION calculate_streak_stats(p_user_id UUID)
RETURNS TABLE (
    streak_count INTEGER,
    streak_broken BOOLEAN,
    total_logged_days INTEGER,
    longest_streak INTEGER,
    logged_dates JSON
) AS $$
DECLARE
    v_today DATE;
    v_yesterday DATE;
    v_checkin_dates DATE[];
    v_transaction_dates DATE[];
    v_current_streak INTEGER := 0;
    v_longest INTEGER := 0;
    v_broken BOOLEAN := false;
    v_logged_dates_json JSON;
    v_total_logged_days INTEGER;
BEGIN
    -- 取得今天和昨天的日期（使用 UTC+8 時區，可根據需求調整）
    v_today := CURRENT_DATE;
    v_yesterday := v_today - INTERVAL '1 day';

    -- 取得所有簽到日期
    SELECT ARRAY_AGG(DISTINCT date ORDER BY date DESC)
    INTO v_checkin_dates
    FROM checkins
    WHERE user_id = p_user_id;

    -- 取得所有有交易的日期（用於計算 total_logged_days）
    SELECT ARRAY_AGG(DISTINCT date ORDER BY date DESC)
    INTO v_transaction_dates
    FROM transactions
    WHERE user_id = p_user_id;

    -- 計算 total_logged_days
    SELECT COUNT(*) INTO v_total_logged_days
    FROM (SELECT DISTINCT date FROM transactions WHERE user_id = p_user_id) AS unique_dates;

    -- 轉換簽到日期為 JSON 陣列（含 date 與 source，供前端區分記帳簽到 / 簽到按鈕）
    SELECT json_agg(json_build_object('date', date::text, 'source', source) ORDER BY date DESC)
    INTO v_logged_dates_json
    FROM checkins
    WHERE user_id = p_user_id;

    -- 計算目前連續記帳天數
    IF v_checkin_dates IS NULL OR array_length(v_checkin_dates, 1) IS NULL THEN
        v_current_streak := 0;
        v_broken := true;
    ELSE
        -- 檢查今天或昨天是否有簽到
        IF v_today = ANY(v_checkin_dates) OR v_yesterday = ANY(v_checkin_dates) THEN
            -- 從今天或昨天開始往回計算連續天數
            DECLARE
                v_start_date DATE;
                v_check_date DATE;
                v_has_checkin BOOLEAN;
            BEGIN
                -- 決定起始日期（今天有簽到就用今天，否則用昨天）
                IF v_today = ANY(v_checkin_dates) THEN
                    v_start_date := v_today;
                ELSE
                    v_start_date := v_yesterday;
                END IF;

                -- 往回計算連續天數
                v_check_date := v_start_date;
                LOOP
                    IF v_check_date = ANY(v_checkin_dates) THEN
                        v_current_streak := v_current_streak + 1;
                        v_check_date := v_check_date - INTERVAL '1 day';
                    ELSE
                        EXIT;
                    END IF;
                END LOOP;
            END;
            v_broken := false;
        ELSE
            v_current_streak := 0;
            v_broken := true;
        END IF;
    END IF;

    -- 計算最長連續記帳天數
    IF v_checkin_dates IS NOT NULL AND array_length(v_checkin_dates, 1) > 0 THEN
        DECLARE
            v_sorted_dates DATE[];
            v_prev_date DATE;
            v_current_run INTEGER := 0;
            v_max_run INTEGER := 0;
            v_date DATE;
        BEGIN
            -- 排序日期（由舊到新）
            SELECT ARRAY_AGG(date ORDER BY date ASC)
            INTO v_sorted_dates
            FROM (SELECT DISTINCT date FROM checkins WHERE user_id = p_user_id) AS unique_dates;

            v_prev_date := NULL;
            FOREACH v_date IN ARRAY v_sorted_dates
            LOOP
                IF v_prev_date IS NULL THEN
                    v_current_run := 1;
                ELSIF v_date = v_prev_date + INTERVAL '1 day' THEN
                    v_current_run := v_current_run + 1;
                ELSE
                    v_current_run := 1;
                END IF;

                IF v_current_run > v_max_run THEN
                    v_max_run := v_current_run;
                END IF;

                v_prev_date := v_date;
            END LOOP;

            v_longest := v_max_run;
        END;
    ELSE
        v_longest := 0;
    END IF;

    -- 回傳結果
    RETURN QUERY SELECT
        v_current_streak,
        v_broken,
        v_total_logged_days,
        v_longest,
        COALESCE(v_logged_dates_json, '[]'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 3. 取得可用幣別列表（供前端動態幣別選單）
-- =============================================================================
-- 功能：從中央 exchange_rates 表回傳所有幣別代碼，前端依此渲染選單
-- 回傳：TEXT[]（幣別代碼陣列，依字母排序）
DROP FUNCTION IF EXISTS get_available_currencies();

CREATE OR REPLACE FUNCTION get_available_currencies()
RETURNS TEXT[] AS $$
    SELECT COALESCE(ARRAY_AGG(currency_code ORDER BY currency_code), ARRAY['TWD']::TEXT[])
    FROM exchange_rates;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 4. 取得匯率（用於新增/編輯交易時計算 TWD 金額）
-- =============================================================================
-- 功能：從中央 exchange_rates 表取得指定貨幣對 TWD 的匯率
-- 參數：p_currency TEXT
-- 回傳：NUMERIC（匯率）
DROP FUNCTION IF EXISTS get_exchange_rate(TEXT);

CREATE OR REPLACE FUNCTION get_exchange_rate(p_currency TEXT)
RETURNS NUMERIC AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    SELECT rate INTO v_rate
    FROM exchange_rates
    WHERE currency_code = UPPER(TRIM(p_currency));

    IF v_rate IS NULL OR v_rate <= 0 THEN
        RETURN 1.0;
    END IF;
    RETURN v_rate;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- 完成！
-- =============================================================================
