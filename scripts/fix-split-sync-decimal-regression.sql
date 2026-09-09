-- =============================================================================
-- Smart Finance Tracker - 補回 sync_split_to_ledger 被覆寫掉的兩處修正（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-09-09 發現 prod 的 sync_split_to_ledger 比 repo 落後兩處。
--
-- 成因是同一天三支腳本的執行順序，加上八月底照抄了中間那一支：
--   2026-07-11 ① fix-split-atomic-add-and-rate-guard.sql  匯率守門、重同步更新日期
--   2026-07-11 ② fix-split-error-codes.sql                RAISE 訊息改錯誤碼
--   2026-07-11 ③ fix-split-join-auth-and-decimal-list.sql 零小數幣別清單、DETAIL 分隔符
--   2026-08-31 ④ fix-split-sync-ownership.sql             擁有權檢查（底稿是 ②，不是 ③）
-- ④ 是最後一次覆寫這支函式，於是 ③ 的兩處改動被一起洗掉。
--
-- 被洗掉的兩處：
--   ① 零小數幣別清單退回 ('TWD','JPY','KRW','VND','HUF','ISK','IDR')
--      正確清單是 ISO 4217 零小數名單 + TWD（本專案慣例），定義在
--      src/lib/constants.js 的 ZERO_DECIMAL_CURRENCIES。
--      影響：群組幣別若是 CLP、XOF 等被漏掉的幣別，寫進帳本的金額會多帶兩位小數；
--      HUF、IDR 則反過來被當成零小數。更麻煩的是 get_split_sync_status 仍是正確清單
--      （③ 也改了它，但 ④ 沒動到它），兩邊四捨五入結果不同時，needs_update 會恆真
--      ——按了「更新同步」金額卻對不上，狀態盒一直停在「有新費用」。
--   ② SPLIT_RATE_UNAVAILABLE 的 DETAIL 分隔符退回頓號 '、'
--      src/lib/splitErrors.js 會把 DETAIL 原樣插進錯誤文案，英文介面下會出現
--      "USD、GBP exchange rate is currently unavailable"。③ 當初就是為此改成 ', '。
--
-- 實務影響：使用者目前的群組幣別是 TWD／GBP／JPY，三者在新舊清單下結果相同，
-- 所以尚未實際受害。這支腳本是把 prod 拉回 repo 的正確定義，不是在救火。
--
-- 函式定義來源：scripts/fix-split-sync-ownership.sql 第 1 節（prod 現況），
-- 除上述兩處外逐字照抄，簽章、LANGUAGE、SECURITY DEFINER、SET search_path 不變。
-- 結果與 database/split-sync-migration.sql 的定義一致（該檔已是合併後的正確版本）。
--
-- 擁有權檢查（ACCOUNT_NOT_OWNED、UPDATE 的 AND user_id、IF NOT FOUND）全部保留，
-- 本腳本不碰 assert_sync_tx_owned trigger，也不碰 get_split_sync_status。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md
-- 的「一次性 SQL 腳本執行紀錄」表格。
-- =============================================================================

-- =============================================================================
-- 1. sync_split_to_ledger：補回零小數幣別清單與 DETAIL 分隔符
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
-- =============================================================================
-- 2. 驗證
-- =============================================================================
-- 寫成單一查詢：Supabase SQL Editor 執行多段 SQL 時只顯示最後一句的輸出，
-- 分開寫等於前面幾項白驗（RAISE NOTICE 同樣不顯示，別用）。
--
-- 預期：每一列的「結果」都等於「預期」。
SELECT * FROM (
  SELECT 1 AS 序, '同步函式已含完整零小數清單（抽驗 XOF）' AS 檢查項目,
    (SELECT (pg_get_functiondef(oid) LIKE '%XOF%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace) AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, '同步函式已無舊清單殘留（HUF 不該出現）',
    (SELECT (pg_get_functiondef(oid) LIKE '%HUF%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'false'
  UNION ALL SELECT 3, '同步函式與狀態函式的清單一致（兩邊都有 XOF）',
    (SELECT (pg_get_functiondef(oid) LIKE '%XOF%')::text FROM pg_proc
      WHERE proname = 'get_split_sync_status' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 4, 'DETAIL 分隔符已改回中性的逗號',
    (SELECT (pg_get_functiondef(oid) LIKE '%se.currency, '', ''%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 5, '擁有權檢查未被洗掉：account 檢查',
    (SELECT (pg_get_functiondef(oid) LIKE '%ACCOUNT_NOT_OWNED%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 6, '擁有權檢查未被洗掉：交易 UPDATE 比對擁有者',
    (SELECT (pg_get_functiondef(oid) LIKE '%AND user_id = v_user_id%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 7, '擁有權檢查未被洗掉：改不到列時明確報錯',
    (SELECT (pg_get_functiondef(oid) LIKE '%SPLIT_SYNC_TX_NOT_OWNED%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 8, '匯率守門未被洗掉',
    (SELECT (pg_get_functiondef(oid) LIKE '%SPLIT_RATE_UNAVAILABLE%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 9, '同步函式仍是 SECURITY DEFINER',
    (SELECT prosecdef::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 10, '同步函式的 search_path 未掉',
    (SELECT array_to_string(proconfig, ',') FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'search_path=public'
  UNION ALL SELECT 11, 'trigger 仍在（本腳本不該動到它）',
    (SELECT tgenabled::text FROM pg_trigger
      WHERE tgrelid = 'split_ledger_syncs'::regclass AND tgname = 'assert_sync_tx_owned'),
    'O'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 對一個尚未同步的群組按「同步至帳本」→ 應成功建立交易，金額小數位正確
--   2) 群組再新增一筆費用後按「更新同步」→ 同一筆交易金額更新，且狀態盒
--      隨即回到「已同步」（不再卡在「有新費用」）
--   3) 幣別為 TWD 的群組同步後金額應為整數，幣別為 GBP 的應保留兩位小數
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在上述實測失敗時使用）
-- =============================================================================
-- 整段重跑 scripts/fix-split-sync-ownership.sql 的第 1 節即可退回本次修改前的定義
-- （該版本除本腳本改的兩處外完全相同）。
