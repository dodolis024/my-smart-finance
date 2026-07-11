-- =============================================================================
-- Smart Finance Tracker - 分帳 RPC 錯誤訊息改為錯誤碼（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：分帳相關 RPC 原本以中文 RAISE EXCEPTION 拋錯，前端 catch 後直接把
-- err.message（中文）顯示在 toast / setError，英文使用者會看到中文。
-- 本腳本將這 6 個函式的 RAISE EXCEPTION 訊息字串改為穩定的 ASCII 錯誤碼，
-- 前端改用既有 i18n（src/lib/splitErrors.js + locales）把碼翻成使用者語言。
--
-- 除了 RAISE EXCEPTION 的訊息字串，其餘全部逐字照抄自各函式「目前最新的定義檔」，
-- 函式簽章、LANGUAGE、SECURITY DEFINER、SET search_path 等一律不變：
-- 1. sync_split_to_ledger    ← scripts/fix-split-atomic-add-and-rate-guard.sql
-- 2. add_split_expense       ← scripts/fix-split-atomic-add-and-rate-guard.sql
-- 3. update_split_expense    ← scripts/fix-split-atomic-add-and-rate-guard.sql
-- 4. join_split_group_as_new_member ← database/split-archive-migration.sql
-- 5. link_self_to_split_member      ← database/split-migration.sql
-- 6. protect_split_group_ownership  ← scripts/fix-security-hardening.sql
--
-- 錯誤碼對照（供前端 src/lib/splitErrors.js 使用）：
-- 未登入 → AUTH_REQUIRED
-- 你不是此群組的已連結成員 → SPLIT_NOT_LINKED_MEMBER
-- 目前無法取得 % 匯率 → SPLIT_RATE_UNAVAILABLE（幣別改用 USING DETAIL 帶）
-- 邀請碼無效 → SPLIT_INVALID_INVITE
-- 此群組已封存 → SPLIT_GROUP_ARCHIVED
-- 你已經是此群組的成員 → SPLIT_ALREADY_MEMBER
-- 只有群組擁有者可以變更擁有權或邀請碼 → SPLIT_OWNER_ONLY
-- 找不到此成員 → SPLIT_MEMBER_NOT_FOUND
-- 此成員已被其他用戶連結 → SPLIT_MEMBER_LINKED
-- 找不到此費用 → SPLIT_EXPENSE_NOT_FOUND
-- 你沒有權限修改此費用 → SPLIT_NO_EDIT_PERMISSION
-- 分攤明細不可為空 → SPLIT_SHARES_EMPTY
-- 分攤成員不屬於此群組 → SPLIT_SHARE_MEMBER_INVALID
-- 你沒有權限在此群組新增費用 → SPLIT_NO_ADD_PERMISSION
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md。
-- =============================================================================

-- =============================================================================
-- 1. sync_split_to_ledger
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
-- 2. add_split_expense
-- =============================================================================
CREATE OR REPLACE FUNCTION add_split_expense(
  p_group_id UUID,
  p_title    TEXT,
  p_amount   NUMERIC,
  p_currency TEXT,
  p_date     DATE,
  p_note     TEXT,
  p_paid_by  UUID,
  p_shares   JSONB  -- [{ "member_id": UUID, "share": NUMERIC }]
)
RETURNS JSON AS $$
DECLARE
  v_expense split_expenses%ROWTYPE;
BEGIN
  IF NOT can_access_split_group(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'SPLIT_NO_ADD_PERMISSION';
  END IF;

  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'array' OR jsonb_array_length(p_shares) = 0 THEN
    RAISE EXCEPTION 'SPLIT_SHARES_EMPTY';
  END IF;

  -- 成員歸屬檢查：付款人與所有分攤成員都必須屬於此群組
  IF (p_paid_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM split_members WHERE id = p_paid_by AND group_id = p_group_id
      ))
     OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_shares) AS s
        WHERE NOT EXISTS (
          SELECT 1 FROM split_members
          WHERE id = (s->>'member_id')::UUID AND group_id = p_group_id
        )
      ) THEN
    RAISE EXCEPTION 'SPLIT_SHARE_MEMBER_INVALID';
  END IF;

  INSERT INTO split_expenses (group_id, paid_by, title, amount, currency, date, note)
  VALUES (p_group_id, p_paid_by, p_title, p_amount, COALESCE(p_currency, 'TWD'), p_date, p_note)
  RETURNING * INTO v_expense;

  INSERT INTO split_expense_shares (expense_id, member_id, share)
  SELECT v_expense.id, (s->>'member_id')::UUID, (s->>'share')::NUMERIC
  FROM jsonb_array_elements(p_shares) AS s;

  RETURN row_to_json(v_expense);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 3. update_split_expense
-- =============================================================================
CREATE OR REPLACE FUNCTION update_split_expense(
  p_expense_id UUID,
  p_title      TEXT,
  p_amount     NUMERIC,
  p_currency   TEXT,
  p_date       DATE,
  p_note       TEXT,
  p_paid_by    UUID,
  p_shares     JSONB  -- [{ "member_id": UUID, "share": NUMERIC }]
)
RETURNS VOID AS $$
DECLARE
  v_group_id UUID;
BEGIN
  SELECT group_id INTO v_group_id FROM split_expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPLIT_EXPENSE_NOT_FOUND';
  END IF;

  IF NOT can_access_split_group(v_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'SPLIT_NO_EDIT_PERMISSION';
  END IF;

  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'array' OR jsonb_array_length(p_shares) = 0 THEN
    RAISE EXCEPTION 'SPLIT_SHARES_EMPTY';
  END IF;

  -- 成員歸屬檢查：付款人與所有分攤成員都必須屬於此群組
  IF (p_paid_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM split_members WHERE id = p_paid_by AND group_id = v_group_id
      ))
     OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_shares) AS s
        WHERE NOT EXISTS (
          SELECT 1 FROM split_members
          WHERE id = (s->>'member_id')::UUID AND group_id = v_group_id
        )
      ) THEN
    RAISE EXCEPTION 'SPLIT_SHARE_MEMBER_INVALID';
  END IF;

  UPDATE split_expenses SET
    paid_by  = p_paid_by,
    title    = p_title,
    amount   = p_amount,
    currency = COALESCE(p_currency, 'TWD'),
    date     = p_date,
    note     = p_note
  WHERE id = p_expense_id;

  DELETE FROM split_expense_shares WHERE expense_id = p_expense_id;

  INSERT INTO split_expense_shares (expense_id, member_id, share)
  SELECT p_expense_id, (s->>'member_id')::UUID, (s->>'share')::NUMERIC
  FROM jsonb_array_elements(p_shares) AS s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 4. join_split_group_as_new_member
-- =============================================================================
CREATE OR REPLACE FUNCTION join_split_group_as_new_member(p_invite_code TEXT, p_name TEXT)
RETURNS JSON AS $$
DECLARE
  v_group_id UUID;
  v_member split_members%ROWTYPE;
BEGIN
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
-- 5. link_self_to_split_member
-- =============================================================================
CREATE OR REPLACE FUNCTION link_self_to_split_member(p_member_id UUID)
RETURNS VOID AS $$
DECLARE
  v_group_id UUID;
  v_existing_user UUID;
BEGIN
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
-- 6. protect_split_group_ownership
-- =============================================================================
CREATE OR REPLACE FUNCTION protect_split_group_ownership()
RETURNS TRIGGER
SET search_path = public
AS $$
BEGIN
  IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.invite_code IS DISTINCT FROM OLD.invite_code)
     AND (auth.uid() IS NULL OR auth.uid() <> OLD.owner_id) THEN
    RAISE EXCEPTION 'SPLIT_OWNER_ONLY';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
