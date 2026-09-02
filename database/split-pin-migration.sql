-- ============================================
-- 分帳群組置頂功能
-- 在 Supabase SQL Editor 手動執行
-- ============================================

-- 置頂是「個人偏好」而非群組屬性：同一個群組多人共用，A 置頂不該影響 B。
-- 因此獨立成表，每人每群組一列，而不是在 split_groups 上加欄位。
CREATE TABLE IF NOT EXISTS split_group_pins (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id  UUID NOT NULL REFERENCES split_groups(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);

-- 列表頁只查「我的置頂」，以 user_id 為前綴的主鍵已足夠支撐；
-- 另補 group_id 索引供群組刪除時的 CASCADE 查找。
CREATE INDEX IF NOT EXISTS idx_split_group_pins_group ON split_group_pins(group_id);

ALTER TABLE split_group_pins ENABLE ROW LEVEL SECURITY;

-- 只看得到、也只動得了自己的置頂記錄
DROP POLICY IF EXISTS "split_group_pins_select" ON split_group_pins;
CREATE POLICY "split_group_pins_select" ON split_group_pins
  FOR SELECT USING (user_id = auth.uid());

-- 只能置頂自己看得到的群組，避免拿別人的 group_id 探測群組是否存在
DROP POLICY IF EXISTS "split_group_pins_insert" ON split_group_pins;
CREATE POLICY "split_group_pins_insert" ON split_group_pins
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND can_access_split_group(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "split_group_pins_delete" ON split_group_pins;
CREATE POLICY "split_group_pins_delete" ON split_group_pins
  FOR DELETE USING (user_id = auth.uid());

-- 前端以 upsert 寫入（重新置頂時更新 pinned_at），PostgREST 會產生
-- INSERT ... ON CONFLICT DO UPDATE。Postgres 走到 DO UPDATE 分支時要求 UPDATE
-- policy，缺了就會被 RLS 擋下。平常 togglePin 已先判斷過置頂狀態不會衝突，
-- 但置頂跨裝置同步：他機已置頂而本機列表尚未更新時，點下去就會撞上既有列。
DROP POLICY IF EXISTS "split_group_pins_update" ON split_group_pins;
CREATE POLICY "split_group_pins_update" ON split_group_pins
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
