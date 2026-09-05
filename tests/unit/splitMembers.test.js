import { describe, it, expect } from 'vitest';
import { countMemberRecords } from '@/lib/splitMembers';

/**
 * 移除成員的守門條件。
 *
 * 外鍵是 ON DELETE CASCADE，刪掉有帳目的成員會靜默破壞既有費用的分攤加總，
 * 代墊的人永遠少收。這裡守的就是「哪些成員不能刪」。
 */

const expenses = [
  { paid_by: 'a', amount: 300, split_expense_shares: [
    { member_id: 'a', share: 100 }, { member_id: 'b', share: 100 }, { member_id: 'c', share: 100 },
  ] },
];
const settlements = [{ from_member: 'b', to_member: 'a', amount: 100 }];

describe('countMemberRecords', () => {
  it('完全沒有帳目的成員可以移除', () => {
    expect(countMemberRecords('d', expenses, settlements))
      .toEqual({ expenseCount: 0, settlementCount: 0, hasRecords: false });
  });

  it('有分攤的成員不可以移除', () => {
    const r = countMemberRecords('c', expenses, settlements);
    expect(r.expenseCount).toBe(1);
    expect(r.hasRecords).toBe(true);
  });

  it('已經還清的成員也不可以移除——還款紀錄會一起被刪掉', () => {
    const r = countMemberRecords('b', expenses, settlements);
    expect(r.expenseCount).toBe(1);
    expect(r.settlementCount).toBe(1);
    expect(r.hasRecords).toBe(true);
  });

  it('只當過付款人、沒有分攤的成員也算有帳目', () => {
    const r = countMemberRecords('a', [{ paid_by: 'a', amount: 100, split_expense_shares: [{ member_id: 'b', share: 100 }] }], []);
    expect(r.expenseCount).toBe(1);
    expect(r.hasRecords).toBe(true);
  });

  it('沒有任何費用或還款時不會出錯', () => {
    expect(countMemberRecords('a').hasRecords).toBe(false);
  });
});
