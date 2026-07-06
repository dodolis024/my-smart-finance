-- =============================================================================
-- Smart Finance Tracker - Subscriptions Migration
-- 訂閱管理功能資料庫結構與 RLS 設定
-- =============================================================================
--
-- 說明：
-- 此表在生產環境已存在（先前只在 Dashboard 手動建立、未納入版控），
-- 本檔案為依程式碼補建的正式定義，供重建資料庫使用；
-- 已存在的環境重複執行無害（皆為 IF NOT EXISTS）。
-- 若與 Dashboard > Table Editor 中的實際結構有出入，以實際結構為準並回頭修正本檔。
--
-- =============================================================================

-- =============================================================================
-- 1. 建立 subscriptions 表（訂閱）
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    amount         NUMERIC(10, 2) NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'TWD',
    category       TEXT,
    payment_method TEXT,
    -- 扣款週期：monthly（每月）/ yearly（每年）；yearly 需搭配 renewal_month
    billing_cycle  TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    renewal_month  SMALLINT CHECK (renewal_month IS NULL OR renewal_month BETWEEN 1 AND 12),
    renewal_day    INTEGER NOT NULL CHECK (renewal_day >= 1 AND renewal_day <= 31),
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 2. transactions 關聯欄位（訂閱自動建立的交易以此防重複扣款）
-- =============================================================================
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL;

-- =============================================================================
-- 3. 索引
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_transactions_subscription_id ON transactions(subscription_id);

-- =============================================================================
-- 4. RLS
-- =============================================================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users can insert their own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users can update their own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users can delete their own subscriptions" ON subscriptions;

CREATE POLICY "Users can view their own subscriptions"
    ON subscriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscriptions"
    ON subscriptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscriptions"
    ON subscriptions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own subscriptions"
    ON subscriptions FOR DELETE
    USING (auth.uid() = user_id);
