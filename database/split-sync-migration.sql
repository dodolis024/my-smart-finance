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
  -- 該筆費用的明細快照：[{expense_id, title, share, currency, date}]
  expense_snapshot JSONB NOT NULL DEFAULT '[]',
  -- 一列 = 一筆費用（見 database/split-sync-per-expense-migration.sql）。
  -- 不用 ON DELETE CASCADE：費用被刪除時若同步記錄跟著消失，就找不到該收掉
  -- 哪一筆帳本交易了；留成 NULL 當線索，由 sync_split_to_ledger 下次清理。
  expense_id UUID REFERENCES split_expenses(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_user        ON split_ledger_syncs(user_id);
CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_group       ON split_ledger_syncs(group_id);
CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_transaction ON split_ledger_syncs(transaction_id);

-- 一筆費用對一個人只該有一列；expense_id 為 NULL（費用已刪、待清理）的列不受限制
CREATE UNIQUE INDEX IF NOT EXISTS idx_split_ledger_syncs_user_expense
  ON split_ledger_syncs (user_id, expense_id)
  WHERE expense_id IS NOT NULL;

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

-- 安全性：上面四條 policy 只檢查「這列是不是自己的」，不檢查 transaction_id
-- 指向的交易是不是自己的。sync_split_to_ledger 會照著這裡記的 transaction_id
-- 去更新交易，因此一列被竄改的同步記錄等於一張覆寫他人交易的許可證。
-- UPDATE policy 缺 WITH CHECK 時 Postgres 沿用 USING，改完 transaction_id 之後
-- user_id = auth.uid() 仍然成立，policy 天生擋不住，故比照
-- protect_split_group_ownership 改用 trigger（見 scripts/fix-split-sync-ownership.sql）。
CREATE OR REPLACE FUNCTION assert_sync_tx_owned()
RETURNS TRIGGER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM transactions
    WHERE id = NEW.transaction_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'SPLIT_SYNC_TX_NOT_OWNED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assert_sync_tx_owned ON split_ledger_syncs;
CREATE TRIGGER assert_sync_tx_owned
  BEFORE INSERT OR UPDATE ON split_ledger_syncs
  FOR EACH ROW
  EXECUTE FUNCTION assert_sync_tx_owned();

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
  v_synced_total   NUMERIC(12, 2);
  v_synced_count   INT;
  v_expense_count  INT;
  v_needs_update   BOOLEAN;
  v_synced_at      TIMESTAMPTZ;
  v_snapshot       JSONB;
  v_decimal_places INT;
BEGIN
  v_user_id := auth.uid();

  SELECT sm.id INTO v_member_id
  FROM split_members sm
  WHERE sm.group_id = p_group_id AND sm.user_id = v_user_id;

  IF v_member_id IS NULL THEN
    RETURN json_build_object('synced', false, 'has_member', false);
  END IF;

  SELECT sg.currency INTO v_group_currency
  FROM split_groups sg
  WHERE sg.id = p_group_id;

  -- 目前的分攤總額（各費用幣別轉換至群組幣別）。
  -- 費用幣別用寫入時凍結的 se.exchange_rate，舊資料沒有才退回現值；
  -- 唯讀顯示，匯率缺失時可能顯示 1:1 估值，寫入路徑已由 sync_split_to_ledger 擋下。
  SELECT
    COALESCE(SUM(
      ses.share *
      CASE
        WHEN se.currency = v_group_currency THEN 1.0
        ELSE (
          COALESCE(se.exchange_rate, (SELECT rate FROM exchange_rates WHERE currency_code = se.currency), 1.0)
          / COALESCE((SELECT rate FROM exchange_rates WHERE currency_code = v_group_currency), 1.0)
        )
      END
    ), 0),
    COUNT(*)
  INTO v_current_total, v_expense_count
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id AND ses.member_id = v_member_id;

  -- 依幣別決定小數位數（此清單須與 src/lib/constants.js 的 ZERO_DECIMAL_CURRENCIES 保持一致）
  v_decimal_places := CASE
    WHEN v_group_currency IN (
      'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
      'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
      'TWD'
    ) THEN 0
    ELSE 2
  END;
  v_current_total := ROUND(v_current_total, v_decimal_places);

  -- 已同步的部分：金額同樣換算到群組幣別，明細合併成一份快照供「查看明細」使用
  SELECT
    COALESCE(SUM(
      sls.synced_amount *
      CASE
        WHEN sls.synced_currency = v_group_currency THEN 1.0
        ELSE (
          COALESCE(se.exchange_rate, (SELECT rate FROM exchange_rates WHERE currency_code = sls.synced_currency), 1.0)
          / COALESCE((SELECT rate FROM exchange_rates WHERE currency_code = v_group_currency), 1.0)
        )
      END
    ), 0),
    COUNT(*),
    MAX(sls.synced_at),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'expense_id', se.id,
        'title',      se.title,
        'share',      sls.synced_amount,
        'currency',   sls.synced_currency,
        'date',       se.date
      ) ORDER BY se.date DESC, se.created_at DESC
    ) FILTER (WHERE se.id IS NOT NULL), '[]'::jsonb)
  INTO v_synced_total, v_synced_count, v_synced_at, v_snapshot
  FROM split_ledger_syncs sls
  LEFT JOIN split_expenses se ON se.id = sls.expense_id
  WHERE sls.user_id = v_user_id AND sls.group_id = p_group_id;

  v_synced_total := ROUND(v_synced_total, v_decimal_places);

  IF v_synced_count = 0 THEN
    RETURN json_build_object(
      'synced',        false,
      'has_member',    true,
      'current_total', v_current_total,
      'currency',      v_group_currency,
      'expense_count', v_expense_count
    );
  END IF;

  SELECT
    -- ① 有費用還沒進帳本
    EXISTS (
      SELECT 1
      FROM split_expense_shares ses
      JOIN split_expenses se ON se.id = ses.expense_id
      WHERE se.group_id = p_group_id AND ses.member_id = v_member_id
        AND NOT EXISTS (
          SELECT 1 FROM split_ledger_syncs s
          WHERE s.user_id = v_user_id AND s.expense_id = se.id
        )
    )
    -- ② 同步記錄指向已刪除、或已不屬於自己分攤的費用
    OR EXISTS (
      SELECT 1
      FROM split_ledger_syncs s
      WHERE s.user_id = v_user_id AND s.group_id = p_group_id
        AND NOT EXISTS (
          SELECT 1
          FROM split_expense_shares ses
          JOIN split_expenses se2 ON se2.id = ses.expense_id
          WHERE se2.id = s.expense_id
            AND se2.group_id = p_group_id
            AND ses.member_id = v_member_id
        )
    )
    -- ③ 費用被改過，帳本那筆還停在舊內容
    OR EXISTS (
      SELECT 1
      FROM split_ledger_syncs s
      JOIN split_expenses se3 ON se3.id = s.expense_id
      JOIN split_expense_shares ses ON ses.expense_id = se3.id AND ses.member_id = v_member_id
      JOIN transactions t ON t.id = s.transaction_id
      WHERE s.user_id = v_user_id AND s.group_id = p_group_id
        AND (
          t.date <> se3.date
          OR t.item_name IS DISTINCT FROM se3.title
          OR t.currency <> se3.currency
          OR ROUND(t.amount, 2) <> ROUND(ses.share, 2)
          OR t.note IS DISTINCT FROM NULLIF(TRIM(se3.note), '')
        )
    )
  INTO v_needs_update;

  RETURN json_build_object(
    'synced',           true,
    'has_member',       true,
    'synced_amount',    v_synced_total,
    'current_total',    v_current_total,
    'currency',         v_group_currency,
    'needs_update',     v_needs_update,
    'synced_at',        v_synced_at,
    'synced_count',     v_synced_count,
    'expense_count',    v_expense_count,
    'expense_snapshot', v_snapshot
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================================================
-- 4. RPC: sync_split_to_ledger
-- 原子操作：計算分攤總額 → 建立或更新個人帳簿交易 → 更新 sync 記錄
-- =============================================================================
-- p_time：新建交易的 time 欄位，由前端帶使用者裝置的本地時間（與手動記帳一致）。
-- 沒帶（舊版前端）就退回台灣時間；不能交給欄位預設以外的 CURRENT_TIME，
-- 資料庫時區是 UTC，會存成比台灣慢 8 小時的時間。已同步過的交易不動 time。
--
-- ⚠️ 簽章曾從 (UUID, TEXT, UUID) 改為加上 p_time：改參數時 CREATE OR REPLACE 只會
-- 在旁邊多蓋一支新函式，舊簽章必須先 DROP（見 scripts/fix-time-defaults-and-settlement-date.sql）。
DROP FUNCTION IF EXISTS sync_split_to_ledger(UUID, TEXT, UUID);
CREATE OR REPLACE FUNCTION sync_split_to_ledger(
  p_group_id       UUID,
  p_payment_method TEXT DEFAULT NULL,
  p_account_id     UUID DEFAULT NULL,
  p_time           TIME DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_id    UUID;
  v_member_id  UUID;
  v_group_name TEXT;
  v_missing    TEXT;
  v_row        RECORD;
  v_rate       NUMERIC(10, 6);
  v_twd        NUMERIC(10, 2);
  v_tx_id      UUID;
  v_created    INT := 0;
  v_updated    INT := 0;
  v_removed    INT := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT sm.id INTO v_member_id
  FROM split_members sm
  WHERE sm.group_id = p_group_id AND sm.user_id = v_user_id;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'SPLIT_NOT_LINKED_MEMBER';
  END IF;

  -- p_account_id 由前端傳入，且本函式是 SECURITY DEFINER（RLS 擋不住），
  -- 因此必須自行確認那個帳戶屬於呼叫者，否則交易會掛在別人的帳戶編號下。
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = p_account_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_OWNED';
  END IF;

  SELECT sg.name INTO v_group_name
  FROM split_groups sg
  WHERE sg.id = p_group_id;

  -- 匯率前置檢查：查無匯率時直接報錯，避免外幣被靜默以 1:1 寫成錯誤的台幣金額。
  -- 已凍結匯率的費用不需要現值；群組幣別不再參與換算，因此也不必檢查。
  SELECT string_agg(DISTINCT se.currency, ', ')
  INTO v_missing
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id
    AND ses.member_id = v_member_id
    AND se.currency <> 'TWD'
    AND se.exchange_rate IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM exchange_rates er
      WHERE er.currency_code = se.currency AND er.rate > 0
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SPLIT_RATE_UNAVAILABLE' USING DETAIL = v_missing;
  END IF;

  -- 先收掉孤兒：費用已被刪除（expense_id 被 SET NULL）或已不屬於自己分攤，
  -- 帳本那筆就不該再留著。
  FOR v_row IN
    SELECT s.id AS sync_id, s.transaction_id
    FROM split_ledger_syncs s
    WHERE s.user_id = v_user_id
      AND s.group_id = p_group_id
      AND NOT EXISTS (
        SELECT 1
        FROM split_expense_shares ses
        JOIN split_expenses se ON se.id = ses.expense_id
        WHERE se.id = s.expense_id
          AND se.group_id = p_group_id
          AND ses.member_id = v_member_id
      )
  LOOP
    DELETE FROM transactions WHERE id = v_row.transaction_id AND user_id = v_user_id;
    DELETE FROM split_ledger_syncs WHERE id = v_row.sync_id;
    v_removed := v_removed + 1;
  END LOOP;

  -- 逐筆費用：已同步的更新內容，沒同步過的建立新交易
  FOR v_row IN
    SELECT
      se.id       AS expense_id,
      se.title    AS title,
      se.date     AS expense_date,
      se.currency AS currency,
      se.note     AS note,
      ses.share   AS share,
      COALESCE(
        se.exchange_rate,
        (SELECT er.rate FROM exchange_rates er WHERE er.currency_code = se.currency),
        1.0
      ) AS rate,
      s.id             AS sync_id,
      s.transaction_id AS transaction_id
    FROM split_expense_shares ses
    JOIN split_expenses se ON se.id = ses.expense_id
    LEFT JOIN split_ledger_syncs s
      ON s.user_id = v_user_id AND s.expense_id = se.id
    WHERE se.group_id = p_group_id AND ses.member_id = v_member_id
    ORDER BY se.date, se.created_at
  LOOP
    v_rate := CASE WHEN v_row.currency = 'TWD' THEN 1.0 ELSE v_row.rate END;
    v_twd  := ROUND(v_row.share * v_rate, 2);

    IF v_row.sync_id IS NOT NULL THEN
      -- category 一併更新：群組改名後，同一個群組不該在圓餅圖上裂成新舊兩塊
      UPDATE transactions SET
        date          = v_row.expense_date,
        item_name     = v_row.title,
        category      = v_group_name,
        currency      = v_row.currency,
        amount        = v_row.share,
        exchange_rate = v_rate,
        twd_amount    = v_twd,
        note          = NULLIF(TRIM(v_row.note), ''),
        updated_at    = NOW()
      WHERE id = v_row.transaction_id
        AND user_id = v_user_id;

      -- transaction_id 對 transactions 是 ON DELETE CASCADE，交易被刪除時這列
      -- 同步記錄會一併消失，所以「匹配 0 列」在正常流程下不可能發生——只有同步
      -- 記錄被指到別人的交易時才會走到這裡。不可靜默略過。
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SPLIT_SYNC_TX_NOT_OWNED';
      END IF;

      UPDATE split_ledger_syncs SET
        synced_amount   = v_row.share,
        synced_currency = v_row.currency,
        synced_at       = NOW(),
        expense_snapshot = jsonb_build_array(jsonb_build_object(
          'expense_id', v_row.expense_id,
          'title',      v_row.title,
          'share',      v_row.share,
          'currency',   v_row.currency,
          'date',       v_row.expense_date
        ))
      WHERE id = v_row.sync_id;

      v_updated := v_updated + 1;
    ELSE
      INSERT INTO transactions (
        user_id, date, time, type, item_name, category,
        payment_method, account_id,
        currency, amount, exchange_rate, twd_amount, note
      ) VALUES (
        v_user_id,
        v_row.expense_date,
        COALESCE(p_time, (now() AT TIME ZONE 'Asia/Taipei')::time),
        'expense',
        v_row.title,
        v_group_name,
        p_payment_method,
        p_account_id,
        v_row.currency,
        v_row.share,
        v_rate,
        v_twd,
        NULLIF(TRIM(v_row.note), '')
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO split_ledger_syncs (
        user_id, group_id, expense_id, transaction_id,
        synced_amount, synced_currency, expense_snapshot
      ) VALUES (
        v_user_id, p_group_id, v_row.expense_id, v_tx_id,
        v_row.share, v_row.currency,
        jsonb_build_array(jsonb_build_object(
          'expense_id', v_row.expense_id,
          'title',      v_row.title,
          'share',      v_row.share,
          'currency',   v_row.currency,
          'date',       v_row.expense_date
        ))
      );

      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success',    true,
    'group_name', v_group_name,
    'created',    v_created,
    'updated',    v_updated,
    'removed',    v_removed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
