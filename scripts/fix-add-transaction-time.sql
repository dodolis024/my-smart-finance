-- =============================================================================
-- Smart Finance Tracker - 交易新增 time 欄位（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 目的：transactions.date 目前只存日期無時間，同一天新增多筆交易時，若事後
-- 補記較早發生的一筆（例如隔天才補記昨天的午餐），會因為只靠 created_at 排序
-- 而排在晚餐之後，順序與實際發生順序不符。
--
-- 新增 time 欄位讓每筆交易都帶有時間，前端新增時預設「當下時間」、可手動調整；
-- 既有資料以 created_at 的時間部分回填（沒有更準確的來源可用，僅為合理近似值）。
--
-- 正式定義已同步更新於 database/supabase-migration.sql（供全新安裝使用）。
-- =============================================================================

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS time TIME;

UPDATE transactions
SET time = created_at::time
WHERE time IS NULL;

ALTER TABLE transactions ALTER COLUMN time SET DEFAULT CURRENT_TIME;
ALTER TABLE transactions ALTER COLUMN time SET NOT NULL;
