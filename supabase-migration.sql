-- =============================================================================
-- Smart Finance Tracker - Supabase Migration SQL Script
-- 完整的資料庫結構與 Row Level Security (RLS) 設定
-- =============================================================================
-- 
-- 使用說明：
-- 1. 在 Supabase Dashboard > SQL Editor 中執行此腳本
-- 2. 確保已啟用 Authentication（Supabase 預設已啟用）
-- 3. 執行後會自動建立所有表、索引、RLS 政策
-- 
-- =============================================================================

-- =============================================================================
-- 1. 啟用必要的擴展
-- =============================================================================
-- UUID 生成函數（PostgreSQL 14+ 預設已啟用，但為確保相容性仍宣告）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 2. 建立 accounts 表（帳戶）
-- =============================================================================
-- 功能：儲存支付方式/帳戶資訊（現金、信用卡、銀行帳戶等）
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('cash', 'credit_card', 'debit_card', 'digital_wallet', 'bank')),
    credit_limit NUMERIC(10, 2),
    billing_day INTEGER CHECK (billing_day >= 1 AND billing_day <= 31),
    payment_due_day INTEGER CHECK (payment_due_day >= 1 AND payment_due_day <= 31),
    current_balance_formula TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3. 建立 transactions 表（交易記錄）
-- =============================================================================
-- 功能：儲存所有收入與支出交易
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    payment_method TEXT, -- 保留欄位，對應 accounts.name（用於向後相容）
    currency TEXT NOT NULL DEFAULT 'TWD',
    amount NUMERIC(10, 2) NOT NULL, -- 原始金額
    exchange_rate NUMERIC(10, 6) DEFAULT 1.0,
    twd_amount NUMERIC(10, 2) NOT NULL, -- 換算為台幣的金額
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 4. 建立 settings 表（設定）
-- =============================================================================
-- 功能：儲存使用者設定，包含匯率、支出類別、收入類別等
CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, key)
);

-- =============================================================================
-- 5. 建立 checkins 表（每日簽到）
-- =============================================================================
-- 功能：記錄每日「有準時記帳或點擊簽到」的日期，用於計算連續記帳天數
CREATE TABLE IF NOT EXISTS checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('onTimeTransaction', 'manual')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date) -- 同一使用者同一天只能有一筆簽到記錄
);

-- =============================================================================
-- 6. 建立索引（提升查詢效能）
-- =============================================================================

-- accounts 表索引
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id_created_at ON accounts(user_id, created_at DESC);

-- transactions 表索引
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id_date ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id_date_type ON transactions(user_id, date DESC, type);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(user_id, category);

-- settings 表索引
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_user_id_key ON settings(user_id, key);

-- checkins 表索引
CREATE INDEX IF NOT EXISTS idx_checkins_user_id ON checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_user_id_date ON checkins(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_user_id_date_unique ON checkins(user_id, date);

-- =============================================================================
-- 7. 啟用 Row Level Security (RLS)
-- =============================================================================

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 8. 建立 RLS 政策（Policy）
-- =============================================================================

-- accounts 表的 RLS 政策
-- SELECT: 使用者只能查看自己的帳戶
CREATE POLICY "Users can view their own accounts"
    ON accounts FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: 使用者只能新增自己的帳戶
CREATE POLICY "Users can insert their own accounts"
    ON accounts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- UPDATE: 使用者只能更新自己的帳戶
CREATE POLICY "Users can update their own accounts"
    ON accounts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE: 使用者只能刪除自己的帳戶
CREATE POLICY "Users can delete their own accounts"
    ON accounts FOR DELETE
    USING (auth.uid() = user_id);

-- transactions 表的 RLS 政策
CREATE POLICY "Users can view their own transactions"
    ON transactions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions"
    ON transactions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
    ON transactions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
    ON transactions FOR DELETE
    USING (auth.uid() = user_id);

-- settings 表的 RLS 政策
CREATE POLICY "Users can view their own settings"
    ON settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings"
    ON settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings"
    ON settings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own settings"
    ON settings FOR DELETE
    USING (auth.uid() = user_id);

-- checkins 表的 RLS 政策
CREATE POLICY "Users can view their own checkins"
    ON checkins FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own checkins"
    ON checkins FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own checkins"
    ON checkins FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own checkins"
    ON checkins FOR DELETE
    USING (auth.uid() = user_id);

-- =============================================================================
-- 9. 建立觸發器（自動更新 updated_at）
-- =============================================================================

-- accounts 表的 updated_at 觸發器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 10. 初始化預設資料（可選）
-- =============================================================================
-- 注意：這些預設資料會在每個使用者首次註冊時透過應用程式邏輯建立
-- 這裡提供一個範例函數，可在應用程式中呼叫

-- 建立預設帳戶的函數（由應用程式在註冊時呼叫）
CREATE OR REPLACE FUNCTION create_default_accounts(p_user_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO accounts (user_id, name, type, credit_limit, billing_day, payment_due_day)
    VALUES
        (p_user_id, 'Cash', 'cash', NULL, NULL, NULL),
        (p_user_id, 'Credit Card 1', 'credit_card', 50000, 5, 25)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 建立預設設定的函數（由應用程式在註冊時呼叫）
CREATE OR REPLACE FUNCTION create_default_settings(p_user_id UUID)
RETURNS void AS $$
BEGIN
    -- 匯率設定（預設值，使用者可後續更新）
    INSERT INTO settings (user_id, key, value)
    VALUES
        (p_user_id, 'TWD', '{"rate": 1.0}'::jsonb),
        (p_user_id, 'USD', '{"rate": 30.0}'::jsonb),
        (p_user_id, 'JPY', '{"rate": 0.2}'::jsonb),
        (p_user_id, 'EUR', '{"rate": 32.0}'::jsonb),
        (p_user_id, 'GBP', '{"rate": 38.0}'::jsonb),
        -- 支出類別
        (p_user_id, 'expense_categories', '["飲食", "飲料", "交通", "娛樂", "購物", "其他"]'::jsonb),
        -- 收入類別
        (p_user_id, 'income_categories', '["薪水", "投資"]'::jsonb)
    ON CONFLICT (user_id, key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 完成！
-- =============================================================================
-- 
-- 下一步：
-- 1. 在 Supabase Dashboard > Authentication > Settings 中確認 Email 認證已啟用
-- 2. 更新前端代碼使用 Supabase Client
-- 3. 執行資料遷移（如有現有資料）
-- 
-- =============================================================================
