-- =============================================================================
-- Smart Finance Tracker - 分帳同步逐筆排除：回滾腳本
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 用途：database/split-sync-exclusion-migration.sql 上線後，若新版
-- get_split_sync_status / sync_split_to_ledger 出問題，用這份把 prod 還原成
-- commit 26b98a0 的狀態（database/split-sync-migration.sql 第 3、4 節，逐字取自
-- `git show 26b98a0:database/split-sync-migration.sql`）。
--
-- 什麼時候用：
--   - 上線後的舊流程回歸檢查（重新同步、新增費用後更新、刪除費用後更新）
--     任何一項失敗
--   - 真實使用者回報同步結果錯誤，且無法立即修正
--
-- ⚠️ 會做的事：
--   1. 還原 get_split_sync_status、sync_split_to_ledger 為舊版（不認得排除清單）
--   2. DROP set_split_sync_excluded
--
-- ⚠️ 刻意不做：不 DROP split_sync_exclusions 表。
--   舊函式完全不讀這張表，留著沒有影響；使用者已設定的排除清單也能保住，
--   修好後重新上線時可直接接著用。
--   回滾期間排除清單不生效：再同步一次，被排除的費用會重新寫回帳本。
--
-- ⚠️ 前端：回滾後，新前端明細彈窗的開關會呼叫已不存在的 RPC 而失敗。
--   若新前端已經 release，必須同一時間把前端 revert。
--
-- 執行後：在 docs/DEPLOYMENT.md 的腳本執行表記一列（日期、原因、執行結果）。
-- =============================================================================

DROP FUNCTION IF EXISTS set_split_sync_excluded(UUID, BOOLEAN);

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
