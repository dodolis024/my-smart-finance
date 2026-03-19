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
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  currency    TEXT NOT NULL DEFAULT 'TWD',
  invite_code TEXT UNIQUE NOT NULL DEFAULT generate_invite_code(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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
$$ LANGUAGE sql SECURITY DEFINER STABLE;

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
$$ LANGUAGE sql SECURITY DEFINER STABLE;

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

-- 只有 owner 可更新/刪除
CREATE POLICY "split_groups_update" ON split_groups
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "split_groups_delete" ON split_groups
  FOR DELETE USING (owner_id = auth.uid());

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 連結自己到已存在的成員位置
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
    RAISE EXCEPTION '找不到此成員';
  END IF;

  -- 確保該位置尚未被連結
  IF v_existing_user IS NOT NULL THEN
    RAISE EXCEPTION '此成員已被其他用戶連結';
  END IF;

  -- 確保用戶未重複加入同一群組
  IF EXISTS (SELECT 1 FROM split_members WHERE group_id = v_group_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION '你已經是此群組的成員';
  END IF;

  UPDATE split_members SET user_id = auth.uid() WHERE id = p_member_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 以新成員身份加入群組（接受邀請碼，不接受 group_id，防止 group_id 外洩後繞過邀請機制）
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
    RAISE EXCEPTION '邀請碼無效';
  END IF;

  -- 確保用戶未重複加入同一群組
  IF EXISTS (SELECT 1 FROM split_members WHERE group_id = v_group_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION '你已經是此群組的成員';
  END IF;

  INSERT INTO split_members (group_id, name, user_id)
  VALUES (v_group_id, trim(p_name), auth.uid())
  RETURNING * INTO v_member;

  RETURN json_build_object('id', v_member.id, 'name', v_member.name, 'user_id', v_member.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
