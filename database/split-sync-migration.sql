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
  -- 上次同步寫進帳本的名稱／分類／備註（分帳那一側的值）。重新同步時拿來判斷
  -- 使用者有沒有在帳本改過：帳本現值 ≠ 這裡的值 → 改過，保留不覆蓋。
  -- 見 database/split-sync-preserve-user-edits-migration.sql
  synced_item_name TEXT,
  synced_category  TEXT,
  synced_note      TEXT,
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
  v_group_name     TEXT;
  v_current_total  NUMERIC(12, 2);
  v_synced_total   NUMERIC(12, 2);
  v_synced_count   INT;
  v_expense_count  INT;
  v_needs_update   BOOLEAN;
  v_synced_at      TIMESTAMPTZ;
  v_snapshot       JSONB;
  v_decimal_places INT;
  v_excluded_count INT;
  v_items          JSONB;
BEGIN
  v_user_id := auth.uid();

  SELECT sm.id INTO v_member_id
  FROM split_members sm
  WHERE sm.group_id = p_group_id AND sm.user_id = v_user_id;

  IF v_member_id IS NULL THEN
    RETURN json_build_object('synced', false, 'has_member', false);
  END IF;

  SELECT sg.currency, sg.name INTO v_group_currency, v_group_name
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
  WHERE se.group_id = p_group_id AND ses.member_id = v_member_id
    AND NOT EXISTS (SELECT 1 FROM split_sync_exclusions x
                    WHERE x.user_id = v_user_id AND x.expense_id = se.id);

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

  -- 所有我有分攤的費用（含被排除的），供「同步明細」逐筆切換；share 為費用原幣
  SELECT
    COUNT(*) FILTER (WHERE x.expense_id IS NOT NULL),
    COALESCE(jsonb_agg(jsonb_build_object(
      'expense_id', se.id,
      'title',      se.title,
      'date',       se.date,
      'share',      ses.share,
      'currency',   se.currency,
      'excluded',   x.expense_id IS NOT NULL
    ) ORDER BY se.date DESC, se.created_at DESC), '[]'::jsonb)
  INTO v_excluded_count, v_items
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  LEFT JOIN split_sync_exclusions x ON x.user_id = v_user_id AND x.expense_id = se.id
  WHERE se.group_id = p_group_id AND ses.member_id = v_member_id;

  IF v_synced_count = 0 THEN
    RETURN json_build_object(
      'synced',         false,
      'has_member',     true,
      'current_total',  v_current_total,
      'currency',       v_group_currency,
      'expense_count',  v_expense_count,
      'excluded_count', v_excluded_count,
      'items',          v_items
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
        AND NOT EXISTS (SELECT 1 FROM split_sync_exclusions x
                        WHERE x.user_id = v_user_id AND x.expense_id = se.id)
    )
    -- ② 同步記錄指向已刪除、已不屬於自己分攤、或已被排除的費用
    --   （排除由 set_split_sync_excluded 原子刪除，這裡只防兩台裝置競態留下的殘留）
    OR EXISTS (
      SELECT 1
      FROM split_ledger_syncs s
      WHERE s.user_id = v_user_id AND s.group_id = p_group_id
        AND (NOT EXISTS (
          SELECT 1
          FROM split_expense_shares ses
          JOIN split_expenses se2 ON se2.id = ses.expense_id
          WHERE se2.id = s.expense_id
            AND se2.group_id = p_group_id
            AND ses.member_id = v_member_id
        )
        OR EXISTS (SELECT 1 FROM split_sync_exclusions x
                   WHERE x.user_id = v_user_id AND x.expense_id = s.expense_id))
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
          -- 名稱、備註、分類比的是「分帳現值 vs 上次同步寫入的值」，不是帳本現值：
          -- 使用者在帳本改過的內容會被保留，拿帳本比會永遠顯示「需要更新」。
          -- 沒有比較基準的舊列（synced_item_name 為 NULL）退回比帳本現值。
          OR se3.title IS DISTINCT FROM COALESCE(s.synced_item_name, t.item_name)
          OR (s.synced_category IS NOT NULL AND s.synced_category IS DISTINCT FROM v_group_name)
          OR t.currency <> se3.currency
          OR ROUND(t.amount, 2) <> ROUND(ses.share, 2)
          OR NULLIF(TRIM(se3.note), '') IS DISTINCT FROM
             CASE WHEN s.synced_item_name IS NULL THEN t.note ELSE s.synced_note END
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
    'expense_snapshot', v_snapshot,
    'excluded_count',   v_excluded_count,
    'items',            v_items
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
  v_kept       INT := 0;
  v_cur_item   TEXT;
  v_cur_cat    TEXT;
  v_cur_note   TEXT;
  v_new_note   TEXT;
  v_item       TEXT;
  v_cat        TEXT;
  v_note       TEXT;
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
    )
    -- 被排除的費用不會寫入帳本，缺匯率也不該擋住整個同步
    AND NOT EXISTS (SELECT 1 FROM split_sync_exclusions x
                    WHERE x.user_id = v_user_id AND x.expense_id = se.id);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SPLIT_RATE_UNAVAILABLE' USING DETAIL = v_missing;
  END IF;

  -- 先收掉孤兒：費用已被刪除（expense_id 被 SET NULL）或已不屬於自己分攤，
  -- 帳本那筆就不該再留著。已被排除的也一併收掉（正常由 set_split_sync_excluded
  -- 原子刪除，這裡只防兩台裝置競態留下的殘留）。
  FOR v_row IN
    SELECT s.id AS sync_id, s.transaction_id
    FROM split_ledger_syncs s
    WHERE s.user_id = v_user_id
      AND s.group_id = p_group_id
      AND (NOT EXISTS (
        SELECT 1
        FROM split_expense_shares ses
        JOIN split_expenses se ON se.id = ses.expense_id
        WHERE se.id = s.expense_id
          AND se.group_id = p_group_id
          AND ses.member_id = v_member_id
      )
      OR EXISTS (SELECT 1 FROM split_sync_exclusions x
                 WHERE x.user_id = v_user_id AND x.expense_id = s.expense_id))
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
      s.id               AS sync_id,
      s.transaction_id   AS transaction_id,
      s.synced_item_name AS synced_item_name,
      s.synced_category  AS synced_category,
      s.synced_note      AS synced_note
    FROM split_expense_shares ses
    JOIN split_expenses se ON se.id = ses.expense_id
    LEFT JOIN split_ledger_syncs s
      ON s.user_id = v_user_id AND s.expense_id = se.id
    WHERE se.group_id = p_group_id AND ses.member_id = v_member_id
      AND NOT EXISTS (SELECT 1 FROM split_sync_exclusions x
                      WHERE x.user_id = v_user_id AND x.expense_id = se.id)
    ORDER BY se.date, se.created_at
  LOOP
    v_rate := CASE WHEN v_row.currency = 'TWD' THEN 1.0 ELSE v_row.rate END;
    v_twd  := ROUND(v_row.share * v_rate, 2);

    v_new_note := NULLIF(TRIM(v_row.note), '');

    IF v_row.sync_id IS NOT NULL THEN
      -- 名稱、分類、備註採三方比較：帳本現值 = 上次同步寫入的值 → 使用者沒動過，
      -- 跟著分帳更新（群組改名後分類也跟著改，圓餅圖不會裂成新舊兩塊）；
      -- 不相等 → 使用者改過，保留。日期、金額、幣別、匯率一律跟分帳走。
      -- synced_item_name 為 NULL 表示這列沒有比較基準（理論上不會發生，
      -- 遷移時已回填），退回舊行為：全部跟著分帳。
      SELECT t.item_name, t.category, t.note
      INTO v_cur_item, v_cur_cat, v_cur_note
      FROM transactions t
      WHERE t.id = v_row.transaction_id AND t.user_id = v_user_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SPLIT_SYNC_TX_NOT_OWNED';
      END IF;

      IF v_row.synced_item_name IS NULL THEN
        v_item := v_row.title;
        v_cat  := v_group_name;
        v_note := v_new_note;
      ELSE
        v_item := CASE WHEN v_cur_item IS DISTINCT FROM v_row.synced_item_name THEN v_cur_item ELSE v_row.title END;
        v_cat  := CASE WHEN v_cur_cat  IS DISTINCT FROM v_row.synced_category  THEN v_cur_cat  ELSE v_group_name END;
        v_note := CASE WHEN v_cur_note IS DISTINCT FROM v_row.synced_note      THEN v_cur_note ELSE v_new_note END;
      END IF;

      -- 只算「保留的內容和分帳現在不一樣」的筆數，前端據此提示
      IF v_item IS DISTINCT FROM v_row.title
         OR v_cat IS DISTINCT FROM v_group_name
         OR v_note IS DISTINCT FROM v_new_note THEN
        v_kept := v_kept + 1;
      END IF;

      UPDATE transactions SET
        date          = v_row.expense_date,
        item_name     = v_item,
        category      = v_cat,
        currency      = v_row.currency,
        amount        = v_row.share,
        exchange_rate = v_rate,
        -- 使用者勾了海外消費的交易：照當時記下的費率重算手續費，併入台幣金額。
        -- 算法與 src/lib/overseasFee.js 的 computeTwdWithFee 相同（本體 × 費率取到分）。
        -- SET 裡引用的 overseas_fee_rate 是更新前的值，同步不會改動費率本身。
        overseas_fee  = CASE WHEN overseas_fee_rate IS NULL THEN NULL
                             ELSE ROUND(v_twd * overseas_fee_rate) / 100 END,
        twd_amount    = CASE WHEN overseas_fee_rate IS NULL THEN v_twd
                             ELSE ROUND(v_twd + ROUND(v_twd * overseas_fee_rate) / 100, 2) END,
        note          = v_note,
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
        -- 記分帳這一側的值（不是保留下來的帳本值），下次才比得出使用者有沒有改過
        synced_item_name = v_row.title,
        synced_category  = v_group_name,
        synced_note      = v_new_note,
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
        v_new_note
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO split_ledger_syncs (
        user_id, group_id, expense_id, transaction_id,
        synced_amount, synced_currency, expense_snapshot,
        synced_item_name, synced_category, synced_note
      ) VALUES (
        v_user_id, p_group_id, v_row.expense_id, v_tx_id,
        v_row.share, v_row.currency,
        jsonb_build_array(jsonb_build_object(
          'expense_id', v_row.expense_id,
          'title',      v_row.title,
          'share',      v_row.share,
          'currency',   v_row.currency,
          'date',       v_row.expense_date
        )),
        v_row.title, v_group_name, v_new_note
      );

      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success',    true,
    'group_name', v_group_name,
    'created',    v_created,
    'updated',    v_updated,
    'removed',    v_removed,
    'kept',       v_kept
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 5. 建立 split_sync_exclusions 表（同步排除清單）
-- 使用者在「同步明細」逐筆關掉的費用：之後的同步一律略過。每人各自一份。
-- =============================================================================
-- 不放進 split_ledger_syncs：那張表的 transaction_id 是 NOT NULL 且 CASCADE，
-- 放不下「沒有帳本交易」的列。
CREATE TABLE IF NOT EXISTS split_sync_exclusions (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 費用刪除時排除紀錄跟著消失即可：沒有帳本交易要收，不需要留線索
  expense_id UUID NOT NULL REFERENCES split_expenses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, expense_id)
);
CREATE INDEX IF NOT EXISTS idx_split_sync_exclusions_expense ON split_sync_exclusions(expense_id);

ALTER TABLE split_sync_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "split_sync_exclusions_select" ON split_sync_exclusions;
CREATE POLICY "split_sync_exclusions_select" ON split_sync_exclusions
  FOR SELECT USING (user_id = auth.uid());
-- 刻意不開 INSERT/UPDATE/DELETE policy：寫入只走 set_split_sync_excluded，
-- 因為「寫排除」與「刪帳本交易」必須在同一個交易內完成

-- =============================================================================
-- 6. RPC: set_split_sync_excluded
-- 切換單筆費用是否同步到帳本。關掉時在同一個交易內刪除帳本那筆；
-- 打開時只移除排除紀錄，加回帳本由前端接著呼叫 sync_split_to_ledger。
-- =============================================================================
CREATE OR REPLACE FUNCTION set_split_sync_excluded(p_expense_id UUID, p_excluded BOOLEAN)
RETURNS JSON AS $$
DECLARE
  v_user_id   UUID;
  v_group_id  UUID;
  v_member_id UUID;
  v_sync_id   UUID;
  v_tx_id     UUID;
  v_removed   INT := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT group_id INTO v_group_id FROM split_expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'SPLIT_EXPENSE_NOT_FOUND';
  END IF;

  SELECT id INTO v_member_id
  FROM split_members
  WHERE group_id = v_group_id AND user_id = v_user_id;
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'SPLIT_NOT_LINKED_MEMBER';
  END IF;

  IF p_excluded THEN
    INSERT INTO split_sync_exclusions (user_id, expense_id)
    VALUES (v_user_id, p_expense_id)
    ON CONFLICT DO NOTHING;

    SELECT id, transaction_id INTO v_sync_id, v_tx_id
    FROM split_ledger_syncs
    WHERE user_id = v_user_id AND expense_id = p_expense_id;

    IF v_sync_id IS NOT NULL THEN
      -- SECURITY DEFINER 擋不住 RLS，刪交易一定要帶 user_id
      DELETE FROM transactions WHERE id = v_tx_id AND user_id = v_user_id;
      DELETE FROM split_ledger_syncs WHERE id = v_sync_id;
      v_removed := 1;
    END IF;
  ELSE
    DELETE FROM split_sync_exclusions
    WHERE user_id = v_user_id AND expense_id = p_expense_id;
  END IF;

  RETURN json_build_object('success', true, 'excluded', p_excluded, 'removed', v_removed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
