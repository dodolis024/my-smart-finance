/**
 * 成員在群組裡留下的帳目筆數。
 *
 * split_expense_shares 與 split_settlements 的 member 外鍵都是 ON DELETE CASCADE，
 * 所以刪掉成員會連他的分攤與還款紀錄一起消失：那些費用的分攤加總不再等於金額，
 * 代墊的人永遠少收，而且畫面上完全看不出來。
 * 已還清的成員也一樣——還款紀錄同樣會被刪掉，等於那筆錢沒還過。
 *
 * 因此只有「完全沒有帳目」的成員可以移除（加錯的人、後來沒來的人）。
 */
export function countMemberRecords(memberId, expenses = [], settlements = []) {
  const expenseCount = expenses.filter((e) =>
    e.paid_by === memberId || (e.split_expense_shares || []).some((s) => s.member_id === memberId)
  ).length;
  const settlementCount = settlements.filter(
    (s) => s.from_member === memberId || s.to_member === memberId
  ).length;
  return { expenseCount, settlementCount, hasRecords: expenseCount > 0 || settlementCount > 0 };
}
