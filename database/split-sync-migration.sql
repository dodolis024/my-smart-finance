-- =============================================================================
-- Smart Finance Tracker - Split Ledger Sync Migration
-- 分帳同步至個人帳簿功能資料庫結構
-- =============================================================================
--
-- 使用說明：
-- 在 Supabase Dashboard > SQL Editor 中執行此腳本
--
-- =============================================================================

-- =============================================================================
-- 1. 建立 split_ledger_syncs 表（分帳同步記錄）
-- =============================================================================
CREATE TABLE IF NOT EXISTS split_ledger_syncs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id         UUID NOT NULL REFERENCES split_groups(id) ON DELETE CASCADE,
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  synced_amount    NUMERIC(12, 2) NOT NULL,
  synced_currency  TEXT NOT NULL DEFAULT 'TWD',
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 同步時的明細快照：[{expense_id, title, share, currency, date}]
  expense_snapshot JSONB NOT NULL DEFAULT '[]',
  UNIQUE (user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_user        ON split_ledger_syncs(user_id);
CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_group       ON split_ledger_syncs(group_id);
CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_transaction ON split_ledger_syncs(transaction_id);

-- =============================================================================
-- 2. RLS
-- =============================================================================
ALTER TABLE split_ledger_syncs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "split_ledger_syncs_select" ON split_ledger_syncs;
DROP POLICY IF EXISTS "split_ledger_syncs_insert" ON split_ledger_syncs;
DROP POLICY IF EXISTS "split_ledger_syncs_update" ON split_ledger_syncs;
DROP POLICY IF EXISTS "split_ledger_syncs_delete" ON split_ledger_syncs;

CREATE POLICY "split_ledger_syncs_select" ON split_ledger_syncs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "split_ledger_syncs_insert" ON split_ledger_syncs
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "split_ledger_syncs_update" ON split_ledger_syncs
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "split_ledger_syncs_delete" ON split_ledger_syncs
  FOR DELETE USING (user_id = auth.uid());

-- =============================================================================
-- 3. RPC: get_split_sync_status
-- 回傳用戶對指定群組的同步狀態，包含是否有未同步費用
-- =============================================================================
CREATE OR REPLACE FUNCTION get_split_sync_status(p_group_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_id        UUID;
  v_member_id      UUID;
  v_group_currency TEXT;
  v_current_total  NUMERIC(12, 2);
  v_sync           split_ledger_syncs%ROWTYPE;
  v_decimal_places INT;
BEGIN
  v_user_id := auth.uid();

  -- 查詢用戶在此群組的 member_id
  SELECT sm.id INTO v_member_id
  FROM split_members sm
  WHERE sm.group_id = p_group_id AND sm.user_id = v_user_id;

  IF v_member_id IS NULL THEN
    RETURN json_build_object('synced', false, 'has_member', false);
  END IF;

  -- 取得群組結算幣別
  SELECT sg.currency INTO v_group_currency
  FROM split_groups sg
  WHERE sg.id = p_group_id;

  -- 計算用戶目前的分攤總額（各費用幣別轉換至群組幣別）
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
  INTO v_current_total
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id AND ses.member_id = v_member_id;

  -- 依幣別決定小數位數
  v_decimal_places := CASE
    WHEN v_group_currency IN ('TWD', 'JPY', 'KRW', 'VND', 'HUF', 'ISK', 'IDR') THEN 0
    ELSE 2
  END;
  v_current_total := ROUND(v_current_total, v_decimal_places);

  -- 查詢既有同步記錄
  SELECT * INTO v_sync
  FROM split_ledger_syncs
  WHERE user_id = v_user_id AND group_id = p_group_id;

  IF v_sync.id IS NULL THEN
    RETURN json_build_object(
      'synced',         false,
      'has_member',     true,
      'current_total',  v_current_total,
      'currency',       v_group_currency
    );
  END IF;

  RETURN json_build_object(
    'synced',           true,
    'has_member',       true,
    'synced_amount',    v_sync.synced_amount,
    'current_total',    v_current_total,
    'currency',         v_group_currency,
    'needs_update',     (ROUND(v_sync.synced_amount, 2) <> ROUND(v_current_total, 2)),
    'synced_at',        v_sync.synced_at,
    'transaction_id',   v_sync.transaction_id,
    'expense_snapshot', v_sync.expense_snapshot
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =============================================================================
-- 4. RPC: sync_split_to_ledger
-- 原子操作：計算分攤總額 → 建立或更新個人帳簿交易 → 更新 sync 記錄
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

  -- 計算分攤總額（轉換至群組幣別）
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

  v_twd_amount := ROUND(v_total_share * v_twd_rate, 0);

  -- 查詢是否已有同步記錄
  SELECT * INTO v_existing_sync
  FROM split_ledger_syncs
  WHERE user_id = v_user_id AND group_id = p_group_id;

  IF v_existing_sync.id IS NOT NULL THEN
    -- 更新既有的個人帳簿交易
    UPDATE transactions SET
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
