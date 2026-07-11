-- =============================================================================
-- Smart Finance Tracker - 分帳加入流程登入檢查 + 零小數幣別清單對齊（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：prod 目前的分帳函式現況＝ scripts/fix-split-error-codes.sql 執行後的版本
-- （RAISE EXCEPTION 已全面改為 ASCII 錯誤碼）。本腳本在此基礎上修正三個問題：
--
-- ① join_split_group_as_new_member 缺少登入檢查（安全修正）
--    函式是 SECURITY DEFINER，全程未檢查 auth.uid() IS NULL。持 anon key（公開）
--    + 有效邀請碼者可插入 user_id = NULL 的幽靈成員；且查重條件
--    user_id = auth.uid() 對 NULL 永不匹配，可重複插入多筆幽靈成員。
--    修法：函式開頭加 auth.uid() IS NULL 檢查，未登入時報 AUTH_REQUIRED。
--
-- ② link_self_to_split_member 同類補強
--    未登入時執行會把成員的 user_id UPDATE 成 NULL，雖近乎無害（多半只是清空
--    既有欄位）但一併加上同樣的登入檢查以保持一致與防禦深度。
--
-- ③ sync_split_to_ledger 的零小數幣別清單對齊前端 + DETAIL 分隔符改中性
--    - v_decimal_places 的 CASE 清單原本手寫 ('TWD','JPY','KRW','VND','HUF',
--      'ISK','IDR')，與前端 src/lib/constants.js 的 ZERO_DECIMAL_CURRENCIES
--      （ISO 完整清單 + TWD，共 18 個幣別）不一致：SQL 多了 HUF/IDR、少了
--      BIF/CLP/DJF/GNF/KMF/MGA/PYG/RWF/UGX/VUV/XAF/XOF/XPF。改為與前端完全
--      相同的 18 個幣別，並加註解交叉引用。
--      行為面：exchange_rates 表現有幣別僅 TWD/USD/JPY/KRW/EUR/GBP，
--      HUF/IDR/CLP 等新舊清單增減的幣別都不在其中，此變更對現有資料
--      無行為差異。
--    - SPLIT_RATE_UNAVAILABLE 的 DETAIL 用 string_agg(..., '、') 組多個幣別，
--      中文頓號在英文介面會顯示成「USD、JPY」，改為 ', '（逗號 + 空格）。
--      前端 zh/en 文案都是直接插值 {currency}，不用改前端。
--
-- ④ get_split_sync_status 的零小數幣別清單同步對齊
--    此唯讀函式（同步狀態顯示）內有同一份手寫清單，與 ③ 一併改為 18 個幣別，
--    避免顯示端與寫入端捨入位數不一致。
--
-- 除了上述修改，其餘全部逐字照抄自 scripts/fix-split-error-codes.sql：
-- 1. join_split_group_as_new_member ← database/split-archive-migration.sql
--                                      與 database/split-migration.sql
-- 2. link_self_to_split_member      ← database/split-migration.sql
-- 3. sync_split_to_ledger           ← database/split-sync-migration.sql
-- 4. get_split_sync_status          ← database/split-sync-migration.sql
--    （此函式未被 fix-split-error-codes.sql 覆蓋，基底為定義檔現行版本）
--
-- 部署順序：僅需在 Supabase SQL Editor 執行本腳本，無前端相依、無需重新部署
-- Edge Functions 或前端。
--
-- 部署後驗證：
-- 1) 登出狀態（或僅持 anon key、不帶登入 session）呼叫
--    join_split_group_as_new_member RPC → 應得 AUTH_REQUIRED，且不應在
--    split_members 留下 user_id 為 NULL 的資料列。
-- 2) 登出狀態呼叫 link_self_to_split_member RPC → 應得 AUTH_REQUIRED。
-- 3) 已登入用戶用有效邀請碼加入群組 → 仍可正常加入（成員 user_id 為自己）。
-- 4) 已登入用戶對含多筆缺匯率幣別費用的群組按「同步到帳本」→
--    SPLIT_RATE_UNAVAILABLE 的 DETAIL 應以 ", " 分隔多個幣別代碼。
-- 5) 群組結算幣別為 TWD/JPY/KRW/VND（原清單就有）與 BIF/CLP 等（新增於
--    清單）時，同步金額應無小數；HUF/IDR（從清單移除）因不在 exchange_rates
--    中本就無法同步，行為不變。
-- 6) 開啟分帳群組的同步狀態框 → 「目前分攤總額」的小數位數應與同步後
--    寫入的金額一致（get_split_sync_status 與 sync_split_to_ledger 同清單）。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md。
-- =============================================================================

-- =============================================================================
-- 1. join_split_group_as_new_member：加登入檢查
-- =============================================================================
CREATE OR REPLACE FUNCTION join_split_group_as_new_member(p_invite_code TEXT, p_name TEXT)
RETURNS JSON AS $$
DECLARE
  v_group_id UUID;
  v_member split_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- 用邀請碼查 group_id，查不到直接擋
  SELECT id INTO v_group_id
  FROM split_groups
  WHERE invite_code = upper(trim(p_invite_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPLIT_INVALID_INVITE';
  END IF;

  -- 已封存的群組不允許加入
  IF EXISTS (SELECT 1 FROM split_groups WHERE id = v_group_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SPLIT_GROUP_ARCHIVED';
  END IF;

  -- 確保用戶未重複加入同一群組
  IF EXISTS (SELECT 1 FROM split_members WHERE group_id = v_group_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'SPLIT_ALREADY_MEMBER';
  END IF;

  INSERT INTO split_members (group_id, name, user_id)
  VALUES (v_group_id, trim(p_name), auth.uid())
  RETURNING * INTO v_member;

  RETURN json_build_object('id', v_member.id, 'name', v_member.name, 'user_id', v_member.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 2. link_self_to_split_member：加登入檢查
-- =============================================================================
CREATE OR REPLACE FUNCTION link_self_to_split_member(p_member_id UUID)
RETURNS VOID AS $$
DECLARE
  v_group_id UUID;
  v_existing_user UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- 取得成員所屬群組與現有 user_id
  SELECT group_id, user_id INTO v_group_id, v_existing_user
  FROM split_members WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPLIT_MEMBER_NOT_FOUND';
  END IF;

  -- 確保該位置尚未被連結
  IF v_existing_user IS NOT NULL THEN
    RAISE EXCEPTION 'SPLIT_MEMBER_LINKED';
  END IF;

  -- 確保用戶未重複加入同一群組
  IF EXISTS (SELECT 1 FROM split_members WHERE group_id = v_group_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'SPLIT_ALREADY_MEMBER';
  END IF;

  UPDATE split_members SET user_id = auth.uid() WHERE id = p_member_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 3. sync_split_to_ledger：零小數幣別清單對齊前端 + DETAIL 分隔符改中性
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
-- 4. get_split_sync_status：零小數幣別清單同步對齊（唯讀顯示函式）
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
  -- 唯讀顯示，匯率缺失時可能顯示 1:1 估值；寫入路徑已由 sync_split_to_ledger 擋下
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
