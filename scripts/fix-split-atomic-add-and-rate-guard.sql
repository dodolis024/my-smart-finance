-- =============================================================================
-- Smart Finance Tracker - 分帳原子化新增與匯率防護修正（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 修正四個問題（正式定義已同步更新於 database/split-migration.sql 與
-- database/split-sync-migration.sql）：
-- ② sync_split_to_ledger 查無匯率時以 COALESCE(..., 1.0) 靜默用 1:1 匯率：
--    寫入路徑改為前置檢查所有涉及幣別，缺匯率直接報錯，不寫入錯誤金額
--    （get_split_sync_status 為唯讀顯示，刻意不動，缺匯率時可能顯示 1:1 估值）
-- ③ 分帳費用新增非原子操作：舊作法先插入費用再插入分攤明細，中途失敗會
--    留下沒有分攤的費用 → 新增 add_split_expense RPC 在單一交易內完成
-- ⑤ 費用的付款人與分攤成員未檢查群組歸屬：add_split_expense 與
--    update_split_expense 都補上「成員必須屬於此群組」的檢查
-- ⑥ 重新同步語意修正：更新既有交易時日期一併更新為今日（金額用今日匯率、
--    日期也應是今日），並將台幣金額改為保留 2 位小數（對齊前端記帳慣例）
--
-- 部署順序（必須依序執行）：
-- 1) 先在 Supabase SQL Editor 執行本腳本
-- 2) supabase functions deploy process-subscriptions
-- 3) 前端隨下次 release 上線
--    （新前端會呼叫 add_split_expense，本腳本必須先跑，否則前端會 404）
--
-- 部署後驗證：
-- 1) 分帳群組新增一筆費用 → 費用與分攤明細都正確建立
-- 2) 對已同步的群組按「重新同步到帳本」→ 交易金額與日期都更新為今日
-- 3) 新增一筆「今天是扣款日」的訂閱 → 有匯率時自動建立今日交易；
--    （可選）暫時清空某幣別匯率驗證會提示「請手動記錄」且不建立交易
-- =============================================================================

-- =============================================================================
-- 1. sync_split_to_ledger：匯率前置檢查 + 重新同步更新日期 + 台幣保留 2 位小數
-- =============================================================================
CREATE OR REPLACE FUNCTION sync_split_to_ledger(
  p_group_id       UUID,
  p_payment_method TEXT DEFAULT NULL,
  p_account_id     UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_id        UUID;
  v_member_id      UUID;
  v_group_name     TEXT;
  v_group_currency TEXT;
  v_total_share    NUMERIC(12, 2);
  v_twd_rate       NUMERIC(10, 6);
  v_twd_amount     NUMERIC(10, 2);
  v_snapshot       JSONB;
  v_existing_sync  split_ledger_syncs%ROWTYPE;
  v_tx_id          UUID;
  v_decimal_places INT;
  v_missing        TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登入';
  END IF;

  -- 查詢用戶在此群組的 member_id
  SELECT sm.id INTO v_member_id
  FROM split_members sm
  WHERE sm.group_id = p_group_id AND sm.user_id = v_user_id;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION '你不是此群組的已連結成員';
  END IF;

  -- 取得群組資訊
  SELECT sg.name, sg.currency INTO v_group_name, v_group_currency
  FROM split_groups sg
  WHERE sg.id = p_group_id;

  -- 匯率前置檢查：寫入路徑查無匯率時直接報錯，避免以 1:1 匯率寫入錯誤金額
  -- （SUM 表達式內無法 RAISE，故在計算前先檢查所有涉及的幣別）
  SELECT string_agg(DISTINCT se.currency, '、')
  INTO v_missing
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id
    AND ses.member_id = v_member_id
    AND se.currency <> v_group_currency
    AND NOT EXISTS (
      SELECT 1 FROM exchange_rates er
      WHERE er.currency_code = se.currency AND er.rate > 0
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '目前無法取得 % 匯率', v_missing;
  END IF;

  -- 群組幣別本身（非 TWD 時）也需有對 TWD 的匯率
  IF v_group_currency <> 'TWD' AND NOT EXISTS (
    SELECT 1 FROM exchange_rates er
    WHERE er.currency_code = v_group_currency AND er.rate > 0
  ) THEN
    RAISE EXCEPTION '目前無法取得 % 匯率', v_group_currency;
  END IF;

  -- 計算分攤總額（轉換至群組幣別；前置檢查通過後 COALESCE 不會走到 fallback）
  SELECT COALESCE(SUM(
    ses.share *
    CASE
      WHEN se.currency = v_group_currency THEN 1.0
      ELSE (
        COALESCE((SELECT rate FROM exchange_rates WHERE currency_code = se.currency), 1.0)
        / COALESCE((SELECT rate FROM exchange_rates WHERE currency_code = v_group_currency), 1.0)
      )
    END
  ), 0)
  INTO v_total_share
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id AND ses.member_id = v_member_id;

  -- 依幣別決定小數位數（TWD/JPY/KRW/VND 等無小數）
  v_decimal_places := CASE
    WHEN v_group_currency IN ('TWD', 'JPY', 'KRW', 'VND', 'HUF', 'ISK', 'IDR') THEN 0
    ELSE 2
  END;
  v_total_share := ROUND(v_total_share, v_decimal_places);

  -- 建立明細快照
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'expense_id', se.id,
      'title',      se.title,
      'share',      ses.share,
      'currency',   se.currency,
      'date',       se.date
    ) ORDER BY se.date DESC, se.created_at DESC
  ), '[]'::jsonb)
  INTO v_snapshot
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id AND ses.member_id = v_member_id;

  -- 取得群組幣別對 TWD 的匯率
  SELECT COALESCE(
    (SELECT rate FROM exchange_rates WHERE currency_code = v_group_currency),
    1.0
  ) INTO v_twd_rate;

  -- 儲存保留至 2 位小數（對齊前端記帳慣例），顯示層才做零小數捨入
  v_twd_amount := ROUND(v_total_share * v_twd_rate, 2);

  -- 查詢是否已有同步記錄
  SELECT * INTO v_existing_sync
  FROM split_ledger_syncs
  WHERE user_id = v_user_id AND group_id = p_group_id;

  IF v_existing_sync.id IS NOT NULL THEN
    -- 更新既有的個人帳簿交易
    -- 重新同步 = 更新到最新狀態：金額用今日匯率、日期也更新為今日，
    -- 避免「舊日期配新匯率」造成報表漂移
    UPDATE transactions SET
      date          = CURRENT_DATE,
      amount        = v_total_share,
      currency      = v_group_currency,
      exchange_rate = v_twd_rate,
      twd_amount    = v_twd_amount,
      item_name     = v_group_name,
      updated_at    = NOW()
    WHERE id = v_existing_sync.transaction_id;

    -- 更新同步記錄
    UPDATE split_ledger_syncs SET
      synced_amount    = v_total_share,
      synced_currency  = v_group_currency,
      synced_at        = NOW(),
      expense_snapshot = v_snapshot
    WHERE id = v_existing_sync.id;

    v_tx_id := v_existing_sync.transaction_id;
  ELSE
    -- 新增個人帳簿交易
    INSERT INTO transactions (
      user_id, date, type, item_name, category,
      payment_method, account_id,
      currency, amount, exchange_rate, twd_amount, note
    ) VALUES (
      v_user_id,
      CURRENT_DATE,
      'expense',
      v_group_name,
      '分帳',
      p_payment_method,
      p_account_id,
      v_group_currency,
      v_total_share,
      v_twd_rate,
      v_twd_amount,
      '從分帳群組同步'
    )
    RETURNING id INTO v_tx_id;

    -- 新增同步記錄
    INSERT INTO split_ledger_syncs (
      user_id, group_id, transaction_id,
      synced_amount, synced_currency, expense_snapshot
    ) VALUES (
      v_user_id, p_group_id, v_tx_id,
      v_total_share, v_group_currency, v_snapshot
    );
  END IF;

  RETURN json_build_object(
    'success',        true,
    'transaction_id', v_tx_id,
    'amount',         v_total_share,
    'currency',       v_group_currency,
    'twd_amount',     v_twd_amount,
    'is_update',      v_existing_sync.id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 2. update_split_expense：補上成員歸屬檢查
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

  -- 成員歸屬檢查：付款人與所有分攤成員都必須屬於此群組
  IF (p_paid_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM split_members WHERE id = p_paid_by AND group_id = v_group_id
      ))
     OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_shares) AS s
        WHERE NOT EXISTS (
          SELECT 1 FROM split_members
          WHERE id = (s->>'member_id')::UUID AND group_id = v_group_id
        )
      ) THEN
    RAISE EXCEPTION '分攤成員不屬於此群組';
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
-- 3. add_split_expense：原子化新增費用 + 分攤明細（含成員歸屬檢查）
-- =============================================================================
CREATE OR REPLACE FUNCTION add_split_expense(
  p_group_id UUID,
  p_title    TEXT,
  p_amount   NUMERIC,
  p_currency TEXT,
  p_date     DATE,
  p_note     TEXT,
  p_paid_by  UUID,
  p_shares   JSONB  -- [{ "member_id": UUID, "share": NUMERIC }]
)
RETURNS JSON AS $$
DECLARE
  v_expense split_expenses%ROWTYPE;
BEGIN
  IF NOT can_access_split_group(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION '你沒有權限在此群組新增費用';
  END IF;

  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'array' OR jsonb_array_length(p_shares) = 0 THEN
    RAISE EXCEPTION '分攤明細不可為空';
  END IF;

  -- 成員歸屬檢查：付款人與所有分攤成員都必須屬於此群組
  IF (p_paid_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM split_members WHERE id = p_paid_by AND group_id = p_group_id
      ))
     OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_shares) AS s
        WHERE NOT EXISTS (
          SELECT 1 FROM split_members
          WHERE id = (s->>'member_id')::UUID AND group_id = p_group_id
        )
      ) THEN
    RAISE EXCEPTION '分攤成員不屬於此群組';
  END IF;

  INSERT INTO split_expenses (group_id, paid_by, title, amount, currency, date, note)
  VALUES (p_group_id, p_paid_by, p_title, p_amount, COALESCE(p_currency, 'TWD'), p_date, p_note)
  RETURNING * INTO v_expense;

  INSERT INTO split_expense_shares (expense_id, member_id, share)
  SELECT v_expense.id, (s->>'member_id')::UUID, (s->>'share')::NUMERIC
  FROM jsonb_array_elements(p_shares) AS s;

  RETURN row_to_json(v_expense);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
