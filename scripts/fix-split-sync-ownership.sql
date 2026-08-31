-- =============================================================================
-- Smart Finance Tracker - 分帳同步至帳本的擁有權檢查（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-08-31 資安健檢 M-3 / M-4。兩者都在 sync_split_to_ledger 這一支
-- SECURITY DEFINER 函式裡，同一種病：信任呼叫端給的識別碼，沒確認那個東西
-- 是不是呼叫者自己的。
--
-- 這支函式的用途：把使用者在某個分帳群組的分攤總額，同步成他個人帳本裡的
-- 一筆支出。再次同步時要更新「上次建立的那一筆」，而不是重複新增，因此
-- split_ledger_syncs 記著「某人在某群組的分攤 → 對應到哪一筆 transaction」。
--
-- ① M-3：更新交易時沒有比對擁有者
--    UPDATE transactions ... WHERE id = v_existing_sync.transaction_id
--    缺 AND user_id = v_user_id。transaction_id 是從 split_ledger_syncs 讀出來的，
--    而那張表的內容使用者可以自己寫：
--      split_ledger_syncs_insert 的 WITH CHECK 只有 user_id = auth.uid()，
--      不檢查 transaction_id 是不是自己的交易。
--    因此把該欄位填成別人的交易編號再觸發同步，那筆交易的日期、金額、幣別、
--    匯率、品項名稱就會被整個蓋掉。
--
--    健檢報告只提到 INSERT 路徑，但 UPDATE 路徑更好走：
--    split_ledger_syncs_update 是 USING (user_id = auth.uid()) 且沒有 WITH CHECK，
--    Postgres 缺 WITH CHECK 時沿用 USING，而改完 transaction_id 之後
--    user_id = auth.uid() 依然成立 → 放行。加上表上有 UNIQUE (user_id, group_id)，
--    攻擊者通常本來就有一列，連 INSERT 都不必。這與 S-1 的 split_members
--    是同一個洞型（見 scripts/fix-split-member-access.sql 第 ② 段）。
--
--    實際難度：transaction_id 是隨機 UUID，且目前沒有已知的洩漏管道，
--    所以報告歸類為「中」。本腳本補的是那一道缺席的檢查，不是在救火。
--
-- ② M-4：p_account_id 沒有驗證擁有者
--    由前端傳入後直接寫進 transactions.account_id，SECURITY DEFINER 讓 RLS
--    擋不住。目前傷害有限（產生的仍是自己的交易列，只是外鍵指向別人的帳戶），
--    但日後任何「用 account_id 去 join 帳戶資訊」的新功能，都會瞬間變成
--    跨用戶資料外洩。
--
-- 修法是一前一後兩道，缺一不可：
--   前：trigger 在寫入 split_ledger_syncs 時就擋掉不屬於自己的 transaction_id
--   後：函式動手改交易前再確認一次，改不到就明確報錯
--   （單靠 trigger，既有的錯誤資料仍會被沿用；單靠函式，壞資料還是寫得進表。）
--
-- 函式定義來源：scripts/fix-split-error-codes.sql 第 1 節（目前最新定義），
-- 除下列三處外逐字照抄，簽章、LANGUAGE、SECURITY DEFINER、SET search_path 不變：
--   - 新增 p_account_id 擁有權檢查
--   - UPDATE transactions 補 AND user_id = v_user_id
--   - 該 UPDATE 之後補 IF NOT FOUND 的明確報錯
--
-- 新增錯誤碼（已同步至 src/lib/splitErrors.js 與 locales/{zh,en}.js）：
--   ACCOUNT_NOT_OWNED        → 此帳戶不屬於你
--   SPLIT_SYNC_TX_NOT_OWNED  → 同步記錄指向的交易不屬於你
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md。
-- =============================================================================

-- =============================================================================
-- 1. sync_split_to_ledger：補上兩處擁有權檢查
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
    WHERE id = v_existing_sync.transaction_id
      AND user_id = v_user_id;

    -- transaction_id 對 transactions 是 ON DELETE CASCADE，交易被刪除時這列
    -- 同步記錄會一併消失，所以「匹配 0 列」在正常流程下不可能發生——只有同步
    -- 記錄被指到別人的交易時才會走到這裡。原本會靜默回傳成功，改為明確擋下。
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
-- 2. split_ledger_syncs：從源頭擋掉指向別人交易的同步記錄
-- =============================================================================
-- 為什麼用 trigger 而不是 CHECK 約束或 policy：
--   - CHECK 不能跨表查詢，無法表達「transaction_id 必須存在於 transactions
--     且該列的 user_id 等於本列的 user_id」。
--   - policy 的 WITH CHECK 雖然看得到新值，但 UPDATE 缺 WITH CHECK 時會沿用
--     USING，補 policy 得同時處理 INSERT 與 UPDATE 兩條、且日後容易再漏。
--     trigger 一次蓋住兩條路徑，與 protect_split_group_ownership、
--     protect_split_member_identity 沿用同一模式。
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
-- 3. 驗證
-- =============================================================================
-- 寫成單一查詢：Supabase SQL Editor 執行多段 SQL 時只顯示最後一句的輸出，
-- 分開寫等於前面幾項白驗（RAISE NOTICE 同樣不顯示，別用）。
--
-- 預期：每一列的「結果」都等於「預期」。
SELECT * FROM (
  SELECT 1 AS 序, '同步函式有 account 擁有權檢查' AS 檢查項目,
    (SELECT (pg_get_functiondef(oid) LIKE '%ACCOUNT_NOT_OWNED%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace) AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, '同步函式的交易 UPDATE 有比對擁有者',
    (SELECT (pg_get_functiondef(oid) LIKE '%AND user_id = v_user_id%')::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 3, '同步函式仍是 SECURITY DEFINER',
    (SELECT prosecdef::text FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 4, '同步函式的 search_path 未掉',
    (SELECT array_to_string(proconfig, ',') FROM pg_proc
      WHERE proname = 'sync_split_to_ledger' AND pronamespace = 'public'::regnamespace),
    'search_path=public'
  UNION ALL SELECT 5, 'trigger 已建立且啟用',
    (SELECT tgenabled::text FROM pg_trigger
      WHERE tgrelid = 'split_ledger_syncs'::regclass AND tgname = 'assert_sync_tx_owned'),
    'O'
  UNION ALL SELECT 6, 'trigger 涵蓋 INSERT 與 UPDATE',
    (SELECT ((tgtype & 4) > 0 AND (tgtype & 16) > 0)::text FROM pg_trigger
      WHERE tgrelid = 'split_ledger_syncs'::regclass AND tgname = 'assert_sync_tx_owned'),
    'true'
  UNION ALL SELECT 7, '既有同步記錄指向他人交易的筆數',
    (SELECT count(*)::text FROM split_ledger_syncs s
      WHERE NOT EXISTS (SELECT 1 FROM transactions t
                        WHERE t.id = s.transaction_id AND t.user_id = s.user_id)),
    '0'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 對一個尚未同步的群組按「同步到個人帳本」→ 應成功建立交易
--   2) 群組再新增一筆費用後按「重新同步」→ 應更新同一筆交易，金額改變
--   3) 同步時指定不同的付款方式／帳戶 → 應成功且記在指定帳戶
--   4) 刪除同步產生的交易後再按同步 → 應重新建立（同步記錄隨 CASCADE 消失）
--   5) 第 7 項驗證若不是 0，先別上線：表示 prod 已有指向他人交易的同步記錄，
--      需要先查清成因（正常使用不會產生），再決定清理方式
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在上述實測失敗時使用）
-- =============================================================================
-- 第 1 段還原：照 scripts/fix-split-error-codes.sql 第 1 節原樣重建函式。
--   ⚠️ 這會把 M-3／M-4 重新打開，只應作為緊急止血。
--
-- 第 2 段還原：
--   DROP TRIGGER IF EXISTS assert_sync_tx_owned ON split_ledger_syncs;
--   DROP FUNCTION IF EXISTS assert_sync_tx_owned();
-- =============================================================================
