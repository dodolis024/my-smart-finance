-- =============================================================================
-- Smart Finance Tracker - 分帳費用與還款凍結匯率
-- 在 Supabase Dashboard > SQL Editor 中執行（可重複執行）
-- =============================================================================
--
-- 背景：split_expenses / split_settlements 從來沒有存匯率，網頁、CLI 與同步到帳本
-- 的 SQL 每次都用 exchange_rates 的「現值」換算。結果是外幣費用換算後的金額每天
-- 跟著匯率浮動：代墊的人隨機賺賠匯差，而還款是用群組幣別記的固定金額，結清之後
-- 外幣費用繼續漂，畫面又冒出一筆零頭，結不完。
--
-- 做法：每筆費用與還款在寫入時凍結「費用日期那天」的匯率，之後一律用凍結值換算。
--   - 語意與 transactions.exchange_rate、exchange_rates.rate 相同：1 單位該幣別 = 多少 TWD。
--     以 TWD 為錨點而不是存「對群組幣別」的比率，因為群組幣別可以在設定裡改，
--     改了之後後者會全部作廢。
--   - 取值順序：get_exchange_rate_on(幣別, 日期) → 查無則用 exchange_rates 現值並標記
--     exchange_rate_estimated = true。查無的情況是日期早於歷史表起點（2026-09-09）
--     或超過 400 天保留期。當天的費用查到的是歷史表最新一筆，與現值同源（同一支
--     update-exchange-rates 寫入），等同即時匯率。
--   - 用 trigger 而不是改 add_split_expense / update_split_expense：還款是前端與 CLI
--     直接 INSERT，沒有 RPC；trigger 一處就涵蓋兩張表、所有寫入路徑，連已安裝的舊版
--     CLI 寫進來的也會凍結，也不必再覆寫一次 RPC（這個 repo 吃過覆寫到舊版的虧，
--     見 scripts/fix-split-sync-decimal-regression.sql）。
--   - 更新時只有幣別或日期變動才重查；改標題、金額、分攤沿用原值。直接 PATCH
--     exchange_rate 也會被還原，凍結值不能從前端竄改。
--
-- 既有資料：執行當下以 exchange_rates 現值鎖住並標記為補記，畫面上的數字在執行
-- 那一刻不變，之後不再浮動。不用歷史匯率回填：9/9 以前查不到，而且改寫已被還款
-- 抵銷的費用，會讓已結清的群組重新冒出餘額。
--
-- 限制：群組幣別不是 TWD 時，換算到群組幣別仍除以群組幣別的現值，群組幣別數字會
-- 小幅浮動（TWD 價值固定）。2026-09-10 查 prod 時 6 個群組全是 TWD。
--
-- 前端與 CLI 的換算在 src/lib/splitSettlement.js 與 tools/core/splitSettlement.js
-- 的 conversionFactor，兩份必須一致。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md
-- 的「一次性 SQL 腳本執行紀錄」表格。
-- =============================================================================

BEGIN;

-- 先拆 trigger：下面的補值是 UPDATE，trigger 在的話會把補值蓋成重查的結果，
-- 重跑時行為就跟第一次不同。
DROP TRIGGER IF EXISTS set_split_expense_rate ON split_expenses;
DROP TRIGGER IF EXISTS set_split_settlement_rate ON split_settlements;

-- =============================================================================
-- 1. 欄位
-- =============================================================================
ALTER TABLE split_expenses    ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(10, 6);
ALTER TABLE split_expenses    ADD COLUMN IF NOT EXISTS exchange_rate_estimated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE split_settlements ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(10, 6);
ALTER TABLE split_settlements ADD COLUMN IF NOT EXISTS exchange_rate_estimated BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- 2. 取得某幣別在某日期的匯率
-- =============================================================================
-- 回傳 o_rate（查無為 NULL）與 o_estimated（是否退回現值）。
-- 幣別不在 exchange_rates 裡時兩者皆無，o_rate = NULL、o_estimated = false，
-- 換算端維持原本的 fallback 行為，不擋記帳。
DROP FUNCTION IF EXISTS resolve_split_rate(TEXT, DATE);

CREATE OR REPLACE FUNCTION resolve_split_rate(
  p_currency  TEXT,
  p_date      DATE,
  OUT o_rate      NUMERIC,
  OUT o_estimated BOOLEAN
)
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(COALESCE(p_currency, 'TWD')));
BEGIN
  o_estimated := false;

  IF v_code = 'TWD' THEN
    o_rate := 1.0;
    RETURN;
  END IF;

  o_rate := get_exchange_rate_on(v_code, COALESCE(p_date, CURRENT_DATE));
  IF o_rate IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT er.rate INTO o_rate
  FROM exchange_rates er
  WHERE er.currency_code = v_code AND er.rate > 0;

  o_estimated := o_rate IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- =============================================================================
-- 3. 寫入時凍結匯率的 trigger 函式（兩張表共用，都有 currency 與 date）
-- =============================================================================
CREATE OR REPLACE FUNCTION set_split_row_rate()
RETURNS TRIGGER
SET search_path = public
AS $$
DECLARE
  v_rate      NUMERIC;
  v_estimated BOOLEAN;
BEGIN
  -- 幣別與日期都沒變、而且已經有匯率 → 沿用原值。
  -- 改標題、金額、分攤不重查；直接 PATCH exchange_rate 也會被還原。
  -- 原值是 NULL（當時查不到）則照常重查，匯率補上之後下次編輯就會有值。
  IF TG_OP = 'UPDATE'
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND OLD.exchange_rate IS NOT NULL THEN
    NEW.exchange_rate := OLD.exchange_rate;
    NEW.exchange_rate_estimated := OLD.exchange_rate_estimated;
    RETURN NEW;
  END IF;

  -- INSERT 一律覆寫，不採信呼叫端帶進來的值
  SELECT r.o_rate, r.o_estimated INTO v_rate, v_estimated
  FROM resolve_split_rate(NEW.currency, NEW.date) AS r;

  NEW.exchange_rate := v_rate;
  NEW.exchange_rate_estimated := COALESCE(v_estimated, false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 4. 既有資料補值（trigger 建立前執行）
-- =============================================================================
-- 只補 exchange_rate IS NULL 的列，重跑不會覆寫已凍結的值。
-- TWD 是精確的 1，不算補記。
UPDATE split_expenses
SET exchange_rate = 1.0, exchange_rate_estimated = false
WHERE exchange_rate IS NULL AND currency = 'TWD';

UPDATE split_expenses se
SET exchange_rate = er.rate, exchange_rate_estimated = true
FROM exchange_rates er
WHERE se.exchange_rate IS NULL
  AND se.currency <> 'TWD'
  AND er.currency_code = se.currency
  AND er.rate > 0;

UPDATE split_settlements
SET exchange_rate = 1.0, exchange_rate_estimated = false
WHERE exchange_rate IS NULL AND currency = 'TWD';

UPDATE split_settlements ss
SET exchange_rate = er.rate, exchange_rate_estimated = true
FROM exchange_rates er
WHERE ss.exchange_rate IS NULL
  AND ss.currency <> 'TWD'
  AND er.currency_code = ss.currency
  AND er.rate > 0;

-- =============================================================================
-- 5. 建立 trigger
-- =============================================================================
-- 之後要手動修正某筆的匯率，需先 ALTER TABLE ... DISABLE TRIGGER，否則會被還原。
CREATE TRIGGER set_split_expense_rate
  BEFORE INSERT OR UPDATE ON split_expenses
  FOR EACH ROW
  EXECUTE FUNCTION set_split_row_rate();

CREATE TRIGGER set_split_settlement_rate
  BEFORE INSERT OR UPDATE ON split_settlements
  FOR EACH ROW
  EXECUTE FUNCTION set_split_row_rate();

-- =============================================================================
-- 6. get_split_sync_status：分攤總額改用凍結匯率
-- =============================================================================
-- 定義與 database/split-sync-migration.sql 逐字一致。
-- 兩支函式的換算式必須相同，否則 needs_update 會恆真。
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
  -- 費用幣別用寫入時凍結的 se.exchange_rate，舊資料沒有才退回現值；
  -- 此處必須與 sync_split_to_ledger 的換算式一致，否則 needs_update 會恆真。
  -- 唯讀顯示，匯率缺失時可能顯示 1:1 估值；寫入路徑已由 sync_split_to_ledger 擋下
  SELECT COALESCE(SUM(
    ses.share *
    CASE
      WHEN se.currency = v_group_currency THEN 1.0
      ELSE (
        COALESCE(se.exchange_rate, (SELECT rate FROM exchange_rates WHERE currency_code = se.currency), 1.0)
        / COALESCE((SELECT rate FROM exchange_rates WHERE currency_code = v_group_currency), 1.0)
      )
    END
  ), 0)
  INTO v_current_total
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================================================
-- 7. sync_split_to_ledger：分攤總額與匯率前置檢查改用凍結匯率
-- =============================================================================
-- 定義與 database/split-sync-migration.sql 逐字一致。以 2026-09-09 的
-- scripts/fix-split-sync-decimal-regression.sql（prod 現況）為底稿，只改換算式與
-- 前置檢查；擁有權檢查、零小數幣別清單、DETAIL 分隔符原樣保留。
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
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- 查詢用戶在此群組的 member_id
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

  -- 取得群組資訊
  SELECT sg.name, sg.currency INTO v_group_name, v_group_currency
  FROM split_groups sg
  WHERE sg.id = p_group_id;

  -- 匯率前置檢查：寫入路徑查無匯率時直接報錯，避免以 1:1 匯率寫入錯誤金額
  -- （SUM 表達式內無法 RAISE，故在計算前先檢查所有涉及的幣別）
  SELECT string_agg(DISTINCT se.currency, ', ')
  INTO v_missing
  FROM split_expense_shares ses
  JOIN split_expenses se ON se.id = ses.expense_id
  WHERE se.group_id = p_group_id
    AND ses.member_id = v_member_id
    AND se.currency <> v_group_currency
    AND se.exchange_rate IS NULL  -- 已凍結匯率的費用不需要現值
    AND NOT EXISTS (
      SELECT 1 FROM exchange_rates er
      WHERE er.currency_code = se.currency AND er.rate > 0
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SPLIT_RATE_UNAVAILABLE' USING DETAIL = v_missing;
  END IF;

  -- 群組幣別本身（非 TWD 時）也需有對 TWD 的匯率
  IF v_group_currency <> 'TWD' AND NOT EXISTS (
    SELECT 1 FROM exchange_rates er
    WHERE er.currency_code = v_group_currency AND er.rate > 0
  ) THEN
    RAISE EXCEPTION 'SPLIT_RATE_UNAVAILABLE' USING DETAIL = v_group_currency;
  END IF;

  -- 計算分攤總額（轉換至群組幣別；前置檢查通過後 COALESCE 不會走到 fallback）
  -- 費用幣別用寫入時凍結的 se.exchange_rate（見 split-expense-rate-migration.sql），
  -- 舊資料沒有才退回現值。群組幣別仍用現值：凍結值以 TWD 為錨點，群組幣別可在設定裡改。
  SELECT COALESCE(SUM(
    ses.share *
    CASE
      WHEN se.currency = v_group_currency THEN 1.0
      ELSE (
        COALESCE(se.exchange_rate, (SELECT rate FROM exchange_rates WHERE currency_code = se.currency), 1.0)
        / COALESCE((SELECT rate FROM exchange_rates WHERE currency_code = v_group_currency), 1.0)
      )
    END
  ), 0)
  INTO v_total_share
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
    WHERE id = v_existing_sync.transaction_id
      AND user_id = v_user_id;

    -- transaction_id 對 transactions 是 ON DELETE CASCADE，交易被刪除時這列
    -- 同步記錄會一併消失，所以「匹配 0 列」在正常流程下不可能發生——只有同步
    -- 記錄被指到別人的交易時才會走到這裡。不可靜默略過。
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SPLIT_SYNC_TX_NOT_OWNED';
    END IF;

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

COMMIT;

-- =============================================================================
-- 8. 驗證
-- =============================================================================
-- 寫成單一查詢：SQL Editor 執行多段 SQL 時只顯示最後一句的輸出。
-- 預期：每一列的「結果」都等於「預期」；標「資訊」的列只是回報數字。
SELECT * FROM (
  SELECT 1 AS 序, '費用表有 exchange_rate 欄位' AS 檢查項目,
    (SELECT COUNT(*)::text FROM information_schema.columns
      WHERE table_name = 'split_expenses' AND column_name IN ('exchange_rate', 'exchange_rate_estimated')) AS 結果,
    '2' AS 預期
  UNION ALL SELECT 2, '還款表有 exchange_rate 欄位',
    (SELECT COUNT(*)::text FROM information_schema.columns
      WHERE table_name = 'split_settlements' AND column_name IN ('exchange_rate', 'exchange_rate_estimated')),
    '2'
  UNION ALL SELECT 3, '有現值可補、卻仍沒有匯率的外幣費用',
    (SELECT COUNT(*)::text FROM split_expenses se
      WHERE se.exchange_rate IS NULL AND se.currency <> 'TWD'
        AND EXISTS (SELECT 1 FROM exchange_rates er WHERE er.currency_code = se.currency AND er.rate > 0)),
    '0'
  UNION ALL SELECT 4, '台幣費用的匯率不是 1',
    (SELECT COUNT(*)::text FROM split_expenses
      WHERE currency = 'TWD' AND exchange_rate IS DISTINCT FROM 1),
    '0'
  UNION ALL SELECT 5, '有現值可補、卻仍沒有匯率的還款',
    (SELECT COUNT(*)::text FROM split_settlements ss
      WHERE ss.exchange_rate IS NULL
        AND (ss.currency = 'TWD'
          OR EXISTS (SELECT 1 FROM exchange_rates er WHERE er.currency_code = ss.currency AND er.rate > 0))),
    '0'
  UNION ALL SELECT 6, '補記的外幣費用筆數',
    (SELECT COUNT(*)::text FROM split_expenses WHERE exchange_rate_estimated),
    '資訊'
  UNION ALL SELECT 7, '費用表 trigger 已建立',
    (SELECT COUNT(*)::text FROM pg_trigger
      WHERE tgname = 'set_split_expense_rate' AND tgrelid = 'split_expenses'::regclass),
    '1'
  UNION ALL SELECT 8, '還款表 trigger 已建立',
    (SELECT COUNT(*)::text FROM pg_trigger
      WHERE tgname = 'set_split_settlement_rate' AND tgrelid = 'split_settlements'::regclass),
    '1'
  UNION ALL SELECT 9, '同步狀態函式改用凍結匯率',
    (SELECT (pg_get_functiondef(oid) LIKE '%COALESCE(se.exchange_rate,%')::text FROM pg_proc
      WHERE proname = 'get_split_sync_status' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 10, '同步函式改用凍結匯率',
    (SELECT (pg_get_functiondef(oid) LIKE '%COALESCE(se.exchange_rate,%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 11, '同步函式仍有帳戶擁有權檢查',
    (SELECT (pg_get_functiondef(oid) LIKE '%ACCOUNT_NOT_OWNED%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 12, '同步函式的零小數清單未退回舊版',
    (SELECT (pg_get_functiondef(oid) LIKE '%''XPF''%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 13, '同步函式仍是 SECURITY DEFINER',
    (SELECT prosecdef::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 14, 'TWD 的匯率固定為 1、不算補記',
    (SELECT o_rate::text || '/' || o_estimated::text FROM resolve_split_rate('TWD', CURRENT_DATE)),
    '1.0/false'
  UNION ALL SELECT 15, '今天的美金查得到歷史匯率、不算補記',
    (SELECT (o_rate > 0)::text || '/' || o_estimated::text FROM resolve_split_rate('USD', CURRENT_DATE)),
    'true/false'
  UNION ALL SELECT 16, '歷史表起點以前的美金退回現值、標記補記',
    (SELECT (o_rate > 0)::text || '/' || o_estimated::text FROM resolve_split_rate('USD', DATE '2026-01-01')),
    'true/true'
) AS checks
ORDER BY 序;
