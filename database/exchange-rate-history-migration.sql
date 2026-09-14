-- ============================================
-- 匯率歷史（每日一列，永久保留）
-- 在 Supabase SQL Editor 手動執行
-- ============================================
--
-- 為什麼要有這張表：exchange_rates 是「現值」，每天被 update-exchange-rates
-- 覆寫，覆寫掉的值就永遠找不回來了。想事後回答「那天的匯率是多少」只能靠這裡。
--
-- 重要限制：只能從執行本 migration 那天開始累積，過去補不回來
-- （exchangerate-api 的歷史端點要付費方案）。

-- 一個幣別一天一列。rate 的語意與 exchange_rates.rate 完全一致：
-- 1 單位該幣別 = 多少 TWD。不另創語意，免得兩張表對不起來。
CREATE TABLE IF NOT EXISTS exchange_rate_history (
  currency_code TEXT NOT NULL,
  date          DATE NOT NULL,
  rate          NUMERIC(10, 6) NOT NULL,
  PRIMARY KEY (currency_code, date)
);

-- 主鍵 (currency_code, date) 一次兼三個用途，因此不需要額外索引：
--   1. 排程同一天重跑會 upsert 覆蓋，而不是長出重複列
--   2. 查詢一律是 WHERE currency_code = ? AND date <= ? ORDER BY date DESC LIMIT 1，
--      正好吃這個複合索引的前綴 + 範圍掃描
--   3. 天然擋掉「同幣別同日兩個值」這種對不起來的髒資料

-- 讀取權限比照 exchange_rates：登入者可讀。
-- 不開 INSERT/UPDATE/DELETE policy——寫入只走 update-exchange-rates 的 service role，
-- service role 本來就繞過 RLS，開了反而是多給前端一條改歷史的路。
ALTER TABLE exchange_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read exchange_rate_history" ON exchange_rate_history;
CREATE POLICY "Authenticated users can read exchange_rate_history"
    ON exchange_rate_history FOR SELECT
    TO authenticated
    USING (true);

-- 建表當下先把現值寫成今天一列，表才不會空到明天排程跑完為止。
-- DO NOTHING 而非 DO UPDATE：本 migration 可重複執行，重跑時不該把排程已經
-- 記下的當日真值蓋成「重跑那一刻的現值」。
INSERT INTO exchange_rate_history (currency_code, date, rate)
SELECT currency_code, (NOW() AT TIME ZONE 'UTC')::DATE, rate
FROM exchange_rates
ON CONFLICT (currency_code, date) DO NOTHING;

-- =============================================================================
-- 取得指定日期的匯率
-- =============================================================================
-- 參數：p_currency TEXT, p_date DATE
--       （參數需依字母序宣告，PostgREST 才找得到，見 supabase-functions.sql 的註記）
-- 回傳：NUMERIC；查無資料時回傳 NULL
--
-- 查的是「小於等於該日期的最新一筆」而不是精準比對日期。歷史表一定會有洞：
-- 週末假日匯率不動、排程也可能停擺（2026-08-26 那次 cron URL 壞掉停了 53 天）。
-- 精準比對會在這些日子回傳查無資料，往前找才拿得到「當時實際生效的匯率」。
--
-- 查無資料回 NULL 而不是 1.0，語意對齊 get_exchange_rate：讓呼叫端能區分
-- 「真的是 1:1」與「沒有資料」，避免外幣被靜默以 1:1 換算。
DROP FUNCTION IF EXISTS get_exchange_rate_on(TEXT, DATE);

CREATE OR REPLACE FUNCTION get_exchange_rate_on(p_currency TEXT, p_date DATE)
RETURNS NUMERIC AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    SELECT rate INTO v_rate
    FROM exchange_rate_history
    WHERE currency_code = UPPER(TRIM(p_currency))
      AND date <= p_date
    ORDER BY date DESC
    LIMIT 1;

    IF v_rate IS NULL OR v_rate <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN v_rate;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
