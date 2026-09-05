-- =============================================================================
-- 移除成員的資料庫層守門（選用，但建議執行）
-- =============================================================================
-- 背景：
--   split_expense_shares.member_id 與 split_settlements 的 from/to_member
--   原本是 ON DELETE CASCADE，刪掉成員會連他的分攤與還款紀錄一起消失，
--   於是那些費用的「分攤加總」不再等於「費用金額」，代墊的人永遠少收，
--   而且畫面上完全看不出來。
--
--   前端已經擋住「有帳目的成員不給刪」，但那只是 UI 層；
--   直接打 API 或未來改動漏掉檢查時仍會發生。這份把保證放進資料庫。
--
-- 執行後的行為：
--   刪除仍有分攤或還款紀錄的成員 → 資料庫直接拒絕（foreign key violation）
--   完全沒有帳目的成員 → 照常可刪
--
-- 在 Supabase SQL Editor 執行即可，不影響既有資料。
-- =============================================================================

ALTER TABLE split_expense_shares
  DROP CONSTRAINT IF EXISTS split_expense_shares_member_id_fkey;
ALTER TABLE split_expense_shares
  ADD CONSTRAINT split_expense_shares_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES split_members(id) ON DELETE RESTRICT;

ALTER TABLE split_settlements
  DROP CONSTRAINT IF EXISTS split_settlements_from_member_fkey;
ALTER TABLE split_settlements
  ADD CONSTRAINT split_settlements_from_member_fkey
  FOREIGN KEY (from_member) REFERENCES split_members(id) ON DELETE RESTRICT;

ALTER TABLE split_settlements
  DROP CONSTRAINT IF EXISTS split_settlements_to_member_fkey;
ALTER TABLE split_settlements
  ADD CONSTRAINT split_settlements_to_member_fkey
  FOREIGN KEY (to_member) REFERENCES split_members(id) ON DELETE RESTRICT;

-- 注意：刪除「群組」時仍然會連帶刪掉成員與所有帳目
-- （split_members.group_id 的 ON DELETE CASCADE 沒有改），這是預期行為。
