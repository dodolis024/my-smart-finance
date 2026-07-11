-- =============================================================================
-- Smart Finance Tracker - Split Expense Migration
-- 多人分帳功能資料庫結構與 RLS 設定
-- =============================================================================
--
-- 使用說明：
-- 在 Supabase Dashboard > SQL Editor 中執行此腳本
--
-- =============================================================================

-- =============================================================================
-- 1. 邀請代碼生成函數
-- =============================================================================
-- 產生隨機 6 碼邀請代碼（大寫字母 + 數字，排除 0/O/I/1 避免混淆）
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. 建立 split_groups 表（分帳群組）
-- =============================================================================
CREATE TABLE IF NOT EXISTS split_groups (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  description               TEXT,
  currency                  TEXT NOT NULL DEFAULT 'TWD',
  default_expense_currency  TEXT,
  invite_code               TEXT UNIQUE NOT NULL DEFAULT generate_invite_code(),
  archived_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- 為既有資料庫新增欄位（執行時若欄位已存在不影響）
ALTER TABLE split_groups ADD COLUMN IF NOT EXISTS default_expense_currency TEXT;
ALTER TABLE split_groups ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- =============================================================================
-- 3. 建立 split_members 表（群組成員）
-- =============================================================================
CREATE TABLE IF NOT EXISTS split_members (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES split_groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)  -- 同一群組內一個帳號只能連結一位成員
);

-- =============================================================================
-- 4. 建立 split_expenses 表（費用）
-- =============================================================================
CREATE TABLE IF NOT EXISTS split_expenses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES split_groups(id) ON DELETE CASCADE,
  paid_by    UUID REFERENCES split_members(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  amount     NUMERIC(12, 2) NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'TWD',
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 5. 建立 split_expense_shares 表（費用分攤明細）
-- =============================================================================
CREATE TABLE IF NOT EXISTS split_expense_shares (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES split_expenses(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES split_members(id) ON DELETE CASCADE,
  share      NUMERIC(12, 2) NOT NULL  -- 該成員應付金額
);

-- =============================================================================
-- 5.5 建立 split_settlements 表（還款紀錄）
-- =============================================================================
CREATE TABLE IF NOT EXISTS split_settlements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES split_groups(id) ON DELETE CASCADE,
  from_member UUID NOT NULL REFERENCES split_members(id) ON DELETE CASCADE,
  to_member  UUID NOT NULL REFERENCES split_members(id) ON DELETE CASCADE,
  amount     NUMERIC(12, 2) NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'TWD',
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 6. 索引
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_split_groups_owner ON split_groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_split_members_group ON split_members(group_id);
CREATE INDEX IF NOT EXISTS idx_split_members_user ON split_members(user_id);
CREATE INDEX IF NOT EXISTS idx_split_expenses_group ON split_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_split_expense_shares_expense ON split_expense_shares(expense_id);
CREATE INDEX IF NOT EXISTS idx_split_settlements_group ON split_settlements(group_id);

-- =============================================================================
-- 7. RLS 啟用
-- =============================================================================
ALTER TABLE split_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_expense_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_settlements ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 7.5 輔助函數（SECURITY DEFINER 打破 RLS 循環遞迴）
-- =============================================================================
-- 查詢用戶所屬的群組 ID（繞過 split_members 的 RLS）
CREATE OR REPLACE FUNCTION get_user_split_group_ids(p_user_id UUID)
RETURNS SETOF UUID AS $$
  SELECT group_id FROM split_members WHERE user_id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- 檢查用戶是否可存取指定群組（owner 或已連結成員）
CREATE OR REPLACE FUNCTION can_access_split_group(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM split_groups
    WHERE id = p_group_id AND owner_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM split_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================================================
-- 8. split_groups RLS policies
-- =============================================================================
-- owner 可讀
CREATE POLICY "split_groups_owner_select" ON split_groups
  FOR SELECT USING (owner_id = auth.uid());

-- 已連結成員可讀（用 SECURITY DEFINER 函數避免遞迴）
CREATE POLICY "split_groups_member_select" ON split_groups
  FOR SELECT USING (
    id IN (SELECT get_user_split_group_ids(auth.uid()))
  );

-- 任何登入用戶可建立
CREATE POLICY "split_groups_insert" ON split_groups
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- 群組成員或 owner 可更新，只有 owner 可刪除
CREATE POLICY "split_groups_update" ON split_groups
  FOR UPDATE USING (can_access_split_group(id, auth.uid()));

CREATE POLICY "split_groups_delete" ON split_groups
  FOR DELETE USING (owner_id = auth.uid());

-- 安全性：UPDATE policy 無法比較新舊值，用 trigger 防止非擁有者
-- 竄改 owner_id（奪走群組擁有權）或 invite_code
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

DROP TRIGGER IF EXISTS protect_split_group_ownership ON split_groups;
CREATE TRIGGER protect_split_group_ownership
  BEFORE UPDATE ON split_groups
  FOR EACH ROW
  EXECUTE FUNCTION protect_split_group_ownership();

-- =============================================================================
-- 9. split_members RLS policies
-- =============================================================================
-- owner 或自己可讀（用 SECURITY DEFINER 函數避免遞迴）
CREATE POLICY "split_members_select" ON split_members
  FOR SELECT USING (
    can_access_split_group(group_id, auth.uid())
  );

-- 群組成員或 owner 可新增成員；加入群組時自己也可新增
CREATE POLICY "split_members_insert" ON split_members
  FOR INSERT WITH CHECK (
    can_access_split_group(group_id, auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "split_members_update" ON split_members
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM split_groups WHERE id = group_id AND owner_id = auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "split_members_delete" ON split_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM split_groups WHERE id = group_id AND owner_id = auth.uid())
  );

-- =============================================================================
-- 10. split_expenses RLS policies
-- =============================================================================
CREATE POLICY "split_expenses_select" ON split_expenses
  FOR SELECT USING (can_access_split_group(group_id, auth.uid()));

CREATE POLICY "split_expenses_insert" ON split_expenses
  FOR INSERT WITH CHECK (can_access_split_group(group_id, auth.uid()));

CREATE POLICY "split_expenses_update" ON split_expenses
  FOR UPDATE USING (can_access_split_group(group_id, auth.uid()));

CREATE POLICY "split_expenses_delete" ON split_expenses
  FOR DELETE USING (can_access_split_group(group_id, auth.uid()));

-- =============================================================================
-- 11. split_expense_shares RLS policies
-- =============================================================================
CREATE POLICY "split_expense_shares_select" ON split_expense_shares
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM split_expenses e
      WHERE e.id = expense_id
        AND can_access_split_group(e.group_id, auth.uid())
    )
  );

CREATE POLICY "split_expense_shares_insert" ON split_expense_shares
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM split_expenses e
      WHERE e.id = expense_id
        AND can_access_split_group(e.group_id, auth.uid())
    )
  );

CREATE POLICY "split_expense_shares_delete" ON split_expense_shares
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM split_expenses e
      WHERE e.id = expense_id
        AND can_access_split_group(e.group_id, auth.uid())
    )
  );

-- =============================================================================
-- 11.5 split_settlements RLS policies
-- =============================================================================
CREATE POLICY "split_settlements_select" ON split_settlements
  FOR SELECT USING (can_access_split_group(group_id, auth.uid()));

CREATE POLICY "split_settlements_insert" ON split_settlements
  FOR INSERT WITH CHECK (can_access_split_group(group_id, auth.uid()));

CREATE POLICY "split_settlements_delete" ON split_settlements
  FOR DELETE USING (can_access_split_group(group_id, auth.uid()));

-- =============================================================================
-- 12. 代碼查詢 RPC（SECURITY DEFINER，允許未連結用戶用代碼查群組）
-- =============================================================================
CREATE OR REPLACE FUNCTION get_group_by_invite_code(p_code TEXT)
RETURNS JSON AS $$
DECLARE
  g split_groups%ROWTYPE;
  members JSON;
BEGIN
  SELECT * INTO g FROM split_groups WHERE invite_code = upper(trim(p_code));
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT json_agg(json_build_object(
    'id', id,
    'name', name,
    'is_linked', (user_id IS NOT NULL),
    'is_self', (user_id = auth.uid())
  ) ORDER BY created_at)
  INTO members
  FROM split_members WHERE group_id = g.id;

  RETURN json_build_object(
    'id', g.id,
    'name', g.name,
    'description', g.description,
    'currency', g.currency,
    'invite_code', g.invite_code,
    'members', COALESCE(members, '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 13. 加入群組 RPC（SECURITY DEFINER，繞過 RLS FK 限制）
-- =============================================================================
-- 取得群組成員的頭像資訊（從 auth.users metadata 讀取）
CREATE OR REPLACE FUNCTION get_split_member_avatars(p_group_id UUID)
RETURNS JSON AS $$
BEGIN
  -- 驗證呼叫者是否為群組成員或 owner
  IF NOT can_access_split_group(p_group_id, auth.uid()) THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'member_id', sm.id,
      'avatar_url', COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
    )), '[]'::json)
    FROM split_members sm
    JOIN auth.users u ON u.id = sm.user_id
    WHERE sm.group_id = p_group_id
      AND sm.user_id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================================================
-- 批次取得多個群組成員的頭像資訊（避免前端逐群組 N 次 RPC）
-- 回傳每筆含 group_id，供前端以 group_id + member_id 對應
CREATE OR REPLACE FUNCTION get_split_member_avatars_batch(p_group_ids UUID[])
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'group_id',   sm.group_id,
      'member_id',  sm.id,
      'avatar_url', COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
    )), '[]'::json)
    FROM split_members sm
    JOIN auth.users u ON u.id = sm.user_id
    WHERE sm.group_id = ANY(p_group_ids)
      AND sm.user_id IS NOT NULL
      -- 沿用單筆版的存取語意：owner 或成員才可讀
      AND can_access_split_group(sm.group_id, auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- 連結自己到已存在的成員位置
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

-- 以新成員身份加入群組（接受邀請碼，不接受 group_id，防止 group_id 外洩後繞過邀請機制）
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
-- 14. 更新費用 RPC（原子操作：更新費用 + 重建分攤明細在同一交易內完成，
--     避免「刪除舊分攤後插入失敗」留下沒有分攤明細的費用）
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
-- 15. 新增費用 RPC（原子操作：建立費用 + 分攤明細在同一交易內完成，
--     避免「費用已建立但分攤明細插入失敗」留下沒有分攤的費用）
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
