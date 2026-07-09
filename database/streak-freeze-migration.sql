-- =============================================================================
-- Smart Finance Tracker - Streak Freeze Migration
-- 連續記帳 streak 的「凍結卡」功能：漏記一天時自動用庫存卡橋接缺口，streak 不歸零
-- =============================================================================
--
-- 說明：
-- 1. 在 Supabase Dashboard > SQL Editor 中執行此腳本
-- 2. 需在 database/supabase-migration.sql（checkins/settings 表）之後執行
-- 3. 凍結卡庫存（balance / earnedTotal / lastGrantLevel）存在既有 settings 表，
--    key = 'streak_freeze'，不另外開庫存表
--
-- =============================================================================

-- =============================================================================
-- 1. 建立 streak_freezes 表（凍結日記錄）
-- =============================================================================
-- 功能：記錄哪些日期是靠凍結卡橋接（未實際記帳/簽到，但用卡保護不中斷連續紀錄）
-- 只保護、不加天數：這裡的日期不計入 streak_count 或 total_logged_days
CREATE TABLE IF NOT EXISTS streak_freezes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date) -- 同一使用者同一天只能有一筆凍結記錄
);

-- =============================================================================
-- 2. 索引
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_streak_freezes_user_id ON streak_freezes(user_id);
CREATE INDEX IF NOT EXISTS idx_streak_freezes_user_id_date ON streak_freezes(user_id, date DESC);

-- =============================================================================
-- 3. 啟用 RLS 並建立政策（比照 checkins 表慣例：使用者只能存取自己的列）
-- =============================================================================
ALTER TABLE streak_freezes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own streak_freezes" ON streak_freezes;
DROP POLICY IF EXISTS "Users can insert their own streak_freezes" ON streak_freezes;
DROP POLICY IF EXISTS "Users can update their own streak_freezes" ON streak_freezes;
DROP POLICY IF EXISTS "Users can delete their own streak_freezes" ON streak_freezes;

CREATE POLICY "Users can view their own streak_freezes"
    ON streak_freezes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own streak_freezes"
    ON streak_freezes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own streak_freezes"
    ON streak_freezes FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own streak_freezes"
    ON streak_freezes FOR DELETE
    USING (auth.uid() = user_id);

-- =============================================================================
-- 完成！
-- =============================================================================
-- 下一步：執行 database/supabase-functions.sql 中的
-- calculate_streak_stats（已改為讀取本表做橋接）與新函數 reconcile_streak_freezes
-- =============================================================================
