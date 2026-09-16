-- =============================================================================
-- 分帳同步改為「一筆費用 = 一筆帳本交易」
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 在此之前：一個群組不論記了幾筆費用，同步到個人帳本永遠只有一筆交易
-- （split_ledger_syncs 的 UNIQUE (user_id, group_id)）。那一筆的欄位全是湊出來的：
--   date      = CURRENT_DATE     → 每按一次同步就整筆搬到當天，跨月跨年都會跑掉
--   item_name = 群組名稱
--   category  = '分帳'           → 一個不在使用者分類清單裡的孤兒分類，
--                                  旅館、餐費、車資全部混在同一塊，看不出錢花在哪
--
-- 改成一筆費用一筆交易之後，這些欄位都有了真實來源：
--   date      = 費用日期
--   item_name = 費用標題
--   category  = 群組名稱         → 群組直接成為圓餅圖裡的一塊，點進去看到的是
--                                  一筆筆真交易，能編輯、能刪除、能點進詳情，
--                                  與點「飲食」走的是同一條路，沒有任何特例
--   amount    = 自己的分攤額（費用原幣），exchange_rate 用該費用凍結的匯率
--   note      = 費用自己的備註；費用沒寫備註就留空，與手動記的交易一致
--
-- 本腳本可重複執行：第 4 節只處理 expense_id IS NULL 的舊列（拆過就不會再拆），
-- 第 5 節只補內容對不上的交易，函式一律 CREATE OR REPLACE。
--
-- 為什麼現在做得成：匯率早先已由 database/split-expense-rate-migration.sql
-- 凍結在每一筆費用上，所以「用費用當天的日期」不會再配到今天的匯率。
--
-- ⚠️ 這支腳本會刪掉既有的彙總交易，改以逐筆費用重建。
--    若你曾手動編輯過那些彙總交易（改分類、改備註、改支付方式），改動會遺失
--    （支付方式與帳戶會沿用到新交易，其餘不會）。執行前請先確認備份。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md。
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. split_ledger_syncs：一列從「一個群組」變成「一筆費用」
-- =============================================================================
-- expense_id 刻意不用 ON DELETE CASCADE：費用被刪除時若連同步記錄一起消失，
-- 就再也找不到該清掉哪一筆帳本交易了。改為 SET NULL 留下線索，
-- 由 sync_split_to_ledger 在下次同步時把孤兒交易一起收掉。
ALTER TABLE split_ledger_syncs
  ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES split_expenses(id) ON DELETE SET NULL;

-- 舊的唯一鍵限制「每人每群組一列」，正是這次要拿掉的前提。
ALTER TABLE split_ledger_syncs
  DROP CONSTRAINT IF EXISTS split_ledger_syncs_user_id_group_id_key;

-- 一筆費用對一個人只該有一列。expense_id 為 NULL（費用已刪、待清理）的列
-- 不受這個限制拘束，Postgres 的 UNIQUE 允許多個 NULL，正好是需要的行為。
DROP INDEX IF EXISTS idx_split_ledger_syncs_user_expense;
CREATE UNIQUE INDEX idx_split_ledger_syncs_user_expense
  ON split_ledger_syncs (user_id, expense_id)
  WHERE expense_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_split_ledger_syncs_user_group
  ON split_ledger_syncs (user_id, group_id);

-- =============================================================================
-- 2. get_split_sync_status：狀態改由「費用集合 vs 同步集合」判斷
-- =============================================================================
-- 顯示用的金額仍換算到群組幣別（狀態盒要拿它比對「帳本記錄 → 最新」），
-- 但 needs_update 不再靠金額相等來判斷——那會漏掉「金額沒變、日期或名稱改了」，
-- 也會漏掉「刪一筆又加一筆剛好抵銷」。改成直接比對三件事：
--   ① 有費用還沒同步  ② 同步記錄指向已不存在的費用  ③ 帳本內容與費用對不上
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
-- 3. sync_split_to_ledger：逐筆費用建立／更新／收掉帳本交易
-- =============================================================================
-- 以 database/split-expense-rate-migration.sql（prod 現況）為底稿，
-- 擁有權檢查與錯誤碼原樣保留，只把「彙總成一筆」換成逐筆處理。
-- 不再需要零小數幣別的取整：amount 直接就是該費用幣別的分攤額，
-- 不經過群組幣別換算，也就沒有湊出小數的機會。
CREATE OR REPLACE FUNCTION sync_split_to_ledger(
  p_group_id       UUID,
  p_payment_method TEXT DEFAULT NULL,
  p_account_id     UUID DEFAULT NULL
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
        user_id, date, type, item_name, category,
        payment_method, account_id,
        currency, amount, exchange_rate, twd_amount, note
      ) VALUES (
        v_user_id,
        v_row.expense_date,
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

-- =============================================================================
-- 4. 既有資料遷移：把每一筆彙總交易拆成逐筆費用
-- =============================================================================
-- 只處理 expense_id IS NULL 的舊列（本次新增的欄位，舊列必定為 NULL），
-- 重跑本腳本時已經拆過的資料不會再被動到。
DO $$
DECLARE
  v_old        RECORD;
  v_exp        RECORD;
  v_group_name TEXT;
  v_member_id  UUID;
  v_pay        TEXT;
  v_account    UUID;
  v_rate       NUMERIC(10, 6);
  v_twd        NUMERIC(10, 2);
  v_tx_id      UUID;
BEGIN
  FOR v_old IN
    SELECT * FROM split_ledger_syncs WHERE expense_id IS NULL
  LOOP
    SELECT sg.name INTO v_group_name
    FROM split_groups sg WHERE sg.id = v_old.group_id;

    SELECT sm.id INTO v_member_id
    FROM split_members sm
    WHERE sm.group_id = v_old.group_id AND sm.user_id = v_old.user_id;

    -- 支付方式與帳戶沿用原本那筆彙總交易，其餘欄位一律由費用重建
    SELECT t.payment_method, t.account_id INTO v_pay, v_account
    FROM transactions t WHERE t.id = v_old.transaction_id;

    IF v_member_id IS NOT NULL AND v_group_name IS NOT NULL THEN
      FOR v_exp IN
        SELECT
          se.id AS expense_id, se.title, se.date, se.currency, se.note, ses.share,
          COALESCE(
            se.exchange_rate,
            (SELECT er.rate FROM exchange_rates er WHERE er.currency_code = se.currency),
            1.0
          ) AS rate
        FROM split_expense_shares ses
        JOIN split_expenses se ON se.id = ses.expense_id
        WHERE se.group_id = v_old.group_id AND ses.member_id = v_member_id
      LOOP
        v_rate := CASE WHEN v_exp.currency = 'TWD' THEN 1.0 ELSE v_exp.rate END;
        v_twd  := ROUND(v_exp.share * v_rate, 2);

        INSERT INTO transactions (
          user_id, date, type, item_name, category,
          payment_method, account_id,
          currency, amount, exchange_rate, twd_amount, note
        ) VALUES (
          v_old.user_id, v_exp.date, 'expense', v_exp.title, v_group_name,
          v_pay, v_account,
          v_exp.currency, v_exp.share, v_rate, v_twd,
          NULLIF(TRIM(v_exp.note), '')
        )
        RETURNING id INTO v_tx_id;

        INSERT INTO split_ledger_syncs (
          user_id, group_id, expense_id, transaction_id,
          synced_amount, synced_currency, synced_at, expense_snapshot
        ) VALUES (
          v_old.user_id, v_old.group_id, v_exp.expense_id, v_tx_id,
          v_exp.share, v_exp.currency, v_old.synced_at,
          jsonb_build_array(jsonb_build_object(
            'expense_id', v_exp.expense_id,
            'title',      v_exp.title,
            'share',      v_exp.share,
            'currency',   v_exp.currency,
            'date',       v_exp.date
          ))
        );
      END LOOP;
    END IF;

    -- 刪掉舊的彙總交易；split_ledger_syncs.transaction_id 是 ON DELETE CASCADE，
    -- 舊的那列同步記錄會跟著消失，不必另外刪。
    DELETE FROM transactions WHERE id = v_old.transaction_id;
  END LOOP;
END $$;

-- =============================================================================
-- 5. 回填備註：把費用自己的備註補到已經建好的交易上
-- =============================================================================
-- 給「先跑過舊版本」的資料庫用：把原本寫死的那句同步說明換成費用自己的備註，
-- 費用沒寫備註的就清空。內容已經一致的不會被動到，也就不會平白改動 updated_at。
UPDATE transactions t
SET note       = NULLIF(TRIM(se.note), ''),
    updated_at = NOW()
FROM split_ledger_syncs s
JOIN split_expenses se ON se.id = s.expense_id
WHERE t.id = s.transaction_id
  AND t.user_id = s.user_id
  AND t.note IS DISTINCT FROM NULLIF(TRIM(se.note), '');

COMMIT;

-- =============================================================================
-- 6. 驗證（SQL Editor 只顯示最後一句的輸出，因此合併成單一查詢）
-- =============================================================================
SELECT 1 AS 序, '同步記錄都掛上費用了' AS 檢查項目,
  (SELECT count(*) = 0 FROM split_ledger_syncs WHERE expense_id IS NULL)::text AS 結果,
  'true' AS 預期
UNION ALL SELECT 2, '一人一費用最多一列',
  (SELECT count(*) = 0 FROM (
     SELECT user_id, expense_id FROM split_ledger_syncs
     WHERE expense_id IS NOT NULL
     GROUP BY user_id, expense_id HAVING count(*) > 1
   ) d)::text,
  'true'
UNION ALL SELECT 3, '沒有交易還掛著孤兒分類「分帳」',
  (SELECT count(*) = 0 FROM transactions t
   WHERE t.category = '分帳'
     AND EXISTS (SELECT 1 FROM split_ledger_syncs s WHERE s.transaction_id = t.id))::text,
  'true'
UNION ALL SELECT 4, '同步交易的日期都等於費用日期',
  (SELECT count(*) = 0
   FROM split_ledger_syncs s
   JOIN split_expenses se ON se.id = s.expense_id
   JOIN transactions t ON t.id = s.transaction_id
   WHERE t.date <> se.date)::text,
  'true'
UNION ALL SELECT 5, '同步交易的分類都等於群組名稱',
  (SELECT count(*) = 0
   FROM split_ledger_syncs s
   JOIN split_groups sg ON sg.id = s.group_id
   JOIN transactions t ON t.id = s.transaction_id
   WHERE t.category IS DISTINCT FROM sg.name)::text,
  'true'
UNION ALL SELECT 6, '同步記錄指向的交易都屬於本人',
  (SELECT count(*) = 0 FROM split_ledger_syncs s
   JOIN transactions t ON t.id = s.transaction_id
   WHERE t.user_id <> s.user_id)::text,
  'true'
UNION ALL SELECT 7, '同步交易的備註都等於費用備註',
  (SELECT count(*) = 0
   FROM split_ledger_syncs s
   JOIN split_expenses se ON se.id = s.expense_id
   JOIN transactions t ON t.id = s.transaction_id
   WHERE t.note IS DISTINCT FROM NULLIF(TRIM(se.note), ''))::text,
  'true'
UNION ALL SELECT 8, '兩支函式都已換成逐筆版本',
  (SELECT bool_and(pg_get_functiondef(oid) LIKE '%expense_id%')
   FROM pg_proc
   WHERE proname IN ('sync_split_to_ledger', 'get_split_sync_status'))::text,
  'true'
ORDER BY 序;

-- =============================================================================
-- Rollback
-- =============================================================================
-- 這支腳本會刪除舊的彙總交易，逐筆交易也已經建立，無法靠 SQL 還原成原樣，
-- 必須從備份還原 transactions 與 split_ledger_syncs 兩張表。
-- 若只是想讓函式退回舊版（資料維持逐筆），重新執行：
--   database/split-expense-rate-migration.sql 的第 6、7 節
-- 並把索引與欄位還原：
--   DROP INDEX IF EXISTS idx_split_ledger_syncs_user_expense;
--   ALTER TABLE split_ledger_syncs
--     ADD CONSTRAINT split_ledger_syncs_user_id_group_id_key UNIQUE (user_id, group_id);
--   ALTER TABLE split_ledger_syncs DROP COLUMN IF EXISTS expense_id;
-- 注意：還原唯一鍵前必須先把同一群組的多列同步記錄清成一列，否則會建不起來。
