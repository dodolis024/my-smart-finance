-- ============================================
-- 訂閱支援年繳週期
-- 在 Supabase SQL Editor 手動執行
-- ============================================

-- 扣款週期：monthly（每月）/ yearly（每年），既有資料預設 monthly
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly'));

-- 年繳扣款月份（1-12），月繳為 NULL
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS renewal_month SMALLINT
    CHECK (renewal_month IS NULL OR renewal_month BETWEEN 1 AND 12);
