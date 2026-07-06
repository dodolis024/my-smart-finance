-- =============================================================================
-- Smart Finance Tracker - 資料完整性修正（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 修正三個問題（正式定義已同步更新於 database/ 與 supabase/migrations/）：
-- 1. push_subscriptions 缺 UPDATE policy：前端以 upsert 註冊推播訂閱，
--    (user_id, endpoint) 衝突時走 UPDATE 路徑會被 RLS 擋下（同裝置金鑰輪替失敗）
-- 2. 分帳費用更新非原子操作：舊作法先刪分攤明細再插入，中途失敗會留下
--    沒有分攤的費用 → 新增 update_split_expense RPC 在單一交易內完成
-- 3. get_exchange_rate 查無匯率時回傳 1.0：呼叫端無法區分「真的是 1.0」與
--    「沒有資料」，外幣會被靜默以 1:1 記帳 → 改回傳 NULL，前端會擋下並提示
--
-- 注意：第 2 項的 RPC 必須先於新版前端部署（前端會改呼叫此 RPC）
-- =============================================================================

-- =============================================================================
-- 1. push_subscriptions UPDATE policy
-- =============================================================================
DROP POLICY IF EXISTS "owner_update" ON public.push_subscriptions;
CREATE POLICY "owner_update" ON public.push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- 2. 更新費用 RPC（原子操作）
-- =============================================================================
CREATE OR REPLACE FUNCTION update_split_expense(
  p_expense_id UUID,
  p_title      TEXT,
  p_amount     NUMERIC,
  p_currency   TEXT,
  p_date       DATE,
  p_note       TEXT,
  p_paid_by    UUID,
  p_shares     JSONB  -- [{ "member_id": UUID, "share": NUMERIC }]
)
RETURNS VOID AS $$
DECLARE
  v_group_id UUID;
BEGIN
  SELECT group_id INTO v_group_id FROM split_expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此費用';
  END IF;

  IF NOT can_access_split_group(v_group_id, auth.uid()) THEN
    RAISE EXCEPTION '你沒有權限修改此費用';
  END IF;

  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'array' OR jsonb_array_length(p_shares) = 0 THEN
    RAISE EXCEPTION '分攤明細不可為空';
  END IF;

  UPDATE split_expenses SET
    paid_by  = p_paid_by,
    title    = p_title,
    amount   = p_amount,
    currency = COALESCE(p_currency, 'TWD'),
    date     = p_date,
    note     = p_note
  WHERE id = p_expense_id;

  DELETE FROM split_expense_shares WHERE expense_id = p_expense_id;

  INSERT INTO split_expense_shares (expense_id, member_id, share)
  SELECT p_expense_id, (s->>'member_id')::UUID, (s->>'share')::NUMERIC
  FROM jsonb_array_elements(p_shares) AS s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 3. get_exchange_rate 查無匯率改回傳 NULL
-- =============================================================================
-- 舊版回傳 1.0，呼叫端無法區分「真的是 1.0」與「沒有匯率資料」；
-- 改回傳 NULL 後：新版前端記帳會擋下並提示、訂閱相關流程維持原本的 1.0 後備行為
CREATE OR REPLACE FUNCTION get_exchange_rate(p_currency TEXT)
RETURNS NUMERIC AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    SELECT rate INTO v_rate
    FROM exchange_rates
    WHERE currency_code = UPPER(TRIM(p_currency));

    IF v_rate IS NULL OR v_rate <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN v_rate;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
