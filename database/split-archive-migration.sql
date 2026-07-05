-- ============================================
-- 分帳群組封存功能
-- 在 Supabase SQL Editor 手動執行
-- ============================================

-- 封存時間（NULL = 未封存）
ALTER TABLE split_groups ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 更新加入群組 RPC：已封存的群組不允許透過邀請碼加入
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

  -- 已封存的群組不允許加入
  IF EXISTS (SELECT 1 FROM split_groups WHERE id = v_group_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION '此群組已封存';
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
