-- =============================================================================
-- Smart Finance Tracker - 交易時間與還款日期改以台灣時鐘為預設（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-09-17 健檢第 ① 項。資料庫的時區是 UTC，而底下三個欄位的預設值
-- 直接用資料庫的時鐘：
--   transactions.time        DEFAULT CURRENT_TIME
--   split_settlements.date   DEFAULT CURRENT_DATE
--   split_expenses.date      DEFAULT CURRENT_DATE
-- 手動記帳的路徑都由客戶端自己帶本地日期與時間，不會踩到；踩到的是「沒帶」的路徑：
--   ① 還款紀錄（網頁、CLI）沒帶 date → 台灣凌晨 0～8 點按「標記已付」會記成前一天，
--      set_split_row_rate 也會用前一天的匯率去凍結這筆還款
--   ② 分帳逐筆同步（sync_split_to_ledger）、訂閱當日扣款（網頁）、訂閱排程（Edge Function）
--      沒帶 time → 存成比台灣慢 8 小時的時間，同一天內的排序被推到清晨；
--      帳戶餘額用 date + time 判斷「這筆是否在設定餘額之後」，同一天先設餘額再同步
--      分帳時可能被誤判成餘額設定之前而不扣
--
-- 本腳本做四件事（單一交易，中途失敗整批 rollback）：
--   1. 三個欄位的預設改成台灣時鐘（now() AT TIME ZONE 'Asia/Taipei'）。
--      這是後備：新版前端／CLI 一律自己帶值，預設只給舊版 CLI（npm 上的 1.3.0
--      還不會帶還款日期）與排程用。選台灣而不是別的時區，是因為排程函式判斷
--      「今天」本來就以 UTC+8 為準，兩邊要一致。
--   2. sync_split_to_ledger 加 p_time 參數：新版前端會帶裝置本地時間，與手動記帳
--      同一個時鐘；沒帶就退回台灣時間。
--      ⚠️ 簽章改了，必須先 DROP 舊簽章 (UUID, TEXT, UUID)：CREATE OR REPLACE 遇到
--      不同簽章只會在旁邊多蓋一支，舊的原封不動（2026-09-17 的教訓，見 DEPLOYMENT.md）。
--      舊版前端只傳 p_group_id 仍可呼叫（其餘參數有預設值），不影響尚未 release 的 main。
--   3. 修正既有資料的 time：只動「從來沒被人手動設過」的列——time 仍等於
--      created_at 的 UTC 時刻（CURRENT_TIME 與 NOW() 同為交易開始時間，
--      2026-08-25 的回填也是 created_at::time，兩者都會命中；人手填的 HH:MM 秒數
--      為 0 不會命中）。改成 created_at 的台灣時刻。從 created_at 推導，重跑不會再動。
--   4. 修正既有還款的 date：只動「date 等於 created_at 的 UTC 日期、且台灣日期不同」
--      的列，改成台灣日期。set_split_row_rate 會因日期變更重新凍結匯率，這是對的。
--
-- 執行順序：先跑本腳本，再 release 前端。新版前端的同步會帶 p_time，
-- 在舊函式上會得到「function sync_split_to_ledger(p_group_id, p_time) does not exist」。
--
-- 可重複執行。正式定義已同步更新：database/supabase-migration.sql、
-- database/split-migration.sql、database/split-sync-migration.sql。
-- 函式本體逐字取自 database/split-sync-migration.sql（底稿：
-- database/split-sync-per-expense-migration.sql，prod 現況），只加 p_time 與 INSERT 的 time。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md
-- 的「一次性 SQL 腳本執行紀錄」表格。
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. 欄位預設改成台灣時鐘
-- =============================================================================
ALTER TABLE transactions
  ALTER COLUMN time SET DEFAULT ((now() AT TIME ZONE 'Asia/Taipei')::time);
ALTER TABLE split_settlements
  ALTER COLUMN date SET DEFAULT ((now() AT TIME ZONE 'Asia/Taipei')::date);
ALTER TABLE split_expenses
  ALTER COLUMN date SET DEFAULT ((now() AT TIME ZONE 'Asia/Taipei')::date);

-- =============================================================================
-- 2. sync_split_to_ledger：加 p_time，新建交易帶時間
-- =============================================================================
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

-- =============================================================================
-- 3. 既有交易的 time：把「從未被人手動設過」的列從 UTC 時刻改成台灣時刻
-- =============================================================================
UPDATE transactions
SET time = (created_at AT TIME ZONE 'Asia/Taipei')::time
WHERE created_at IS NOT NULL
  AND time = (created_at AT TIME ZONE 'UTC')::time;

-- =============================================================================
-- 4. 既有還款的 date：UTC 日期與台灣日期不同的列改成台灣日期
-- =============================================================================
UPDATE split_settlements
SET date = (created_at AT TIME ZONE 'Asia/Taipei')::date
WHERE created_at IS NOT NULL
  AND date = (created_at AT TIME ZONE 'UTC')::date
  AND date <> (created_at AT TIME ZONE 'Asia/Taipei')::date;

COMMIT;

-- =============================================================================
-- 驗證（單一查詢；SQL Editor 只顯示最後一句的輸出）
-- 預期：每一列的「結果」都等於「預期」
-- =============================================================================
SELECT * FROM (
  SELECT 1 AS 序, 'transactions.time 預設已改台灣時鐘' AS 檢查項目,
    (SELECT (pg_get_expr(d.adbin, d.adrelid) LIKE '%Asia/Taipei%')::text
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'transactions'::regclass AND a.attname = 'time') AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, 'split_settlements.date 預設已改台灣時鐘',
    (SELECT (pg_get_expr(d.adbin, d.adrelid) LIKE '%Asia/Taipei%')::text
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'split_settlements'::regclass AND a.attname = 'date'),
    'true'
  UNION ALL SELECT 3, 'split_expenses.date 預設已改台灣時鐘',
    (SELECT (pg_get_expr(d.adbin, d.adrelid) LIKE '%Asia/Taipei%')::text
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'split_expenses'::regclass AND a.attname = 'date'),
    'true'
  UNION ALL SELECT 4, 'sync_split_to_ledger 只剩一個版本（舊簽章已 DROP）',
    (SELECT count(*)::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    '1'
  UNION ALL SELECT 5, 'sync_split_to_ledger 簽章含 p_time',
    (SELECT (pg_get_function_identity_arguments(oid) LIKE '%p_time time%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 6, 'sync_split_to_ledger 的 search_path 未掉',
    (SELECT array_to_string(proconfig, ',') FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'search_path=public'
  UNION ALL SELECT 7, 'sync_split_to_ledger 仍是 SECURITY DEFINER',
    (SELECT prosecdef::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 8, 'authenticated 仍可執行 sync_split_to_ledger',
    (SELECT has_function_privilege('authenticated',
      'sync_split_to_ledger(uuid, text, uuid, time)', 'EXECUTE')::text),
    'true'
  UNION ALL SELECT 9, '仍等於 created_at UTC 時刻的交易筆數（第 3 節應已清空）',
    (SELECT count(*)::text FROM transactions
      WHERE created_at IS NOT NULL AND time = (created_at AT TIME ZONE 'UTC')::time
        AND (created_at AT TIME ZONE 'UTC')::time <> (created_at AT TIME ZONE 'Asia/Taipei')::time),
    '0'
  UNION ALL SELECT 10, '仍停在 UTC 日期的還款筆數（第 4 節應已清空）',
    (SELECT count(*)::text FROM split_settlements
      WHERE created_at IS NOT NULL AND date = (created_at AT TIME ZONE 'UTC')::date
        AND date <> (created_at AT TIME ZONE 'Asia/Taipei')::date),
    '0'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 舊版前端（main 尚未 release 時）在分帳群組按「同步」→ 應成功，新交易的 time 為台灣時間
--   2) release 後的新版前端按「同步」→ 應成功，新交易的 time 為裝置本地時間
--   3) 分帳按「標記已付」→ 結算歷史的日期應為裝置本地日期
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在實測失敗時使用；第 3、4 節的資料修正可由 created_at 反推）
-- =============================================================================
-- ALTER TABLE transactions      ALTER COLUMN time SET DEFAULT CURRENT_TIME;
-- ALTER TABLE split_settlements ALTER COLUMN date SET DEFAULT CURRENT_DATE;
-- ALTER TABLE split_expenses    ALTER COLUMN date SET DEFAULT CURRENT_DATE;
-- 函式：以 database/split-sync-per-expense-migration.sql 第 3 節重建舊簽章
--   （先 DROP FUNCTION sync_split_to_ledger(UUID, TEXT, UUID, TIME)）。
-- UPDATE transactions SET time = (created_at AT TIME ZONE 'UTC')::time
--   WHERE time = (created_at AT TIME ZONE 'Asia/Taipei')::time;
