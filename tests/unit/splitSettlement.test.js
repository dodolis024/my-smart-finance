import { describe, it, expect } from 'vitest';
import { calcSettlement } from '@/lib/splitSettlement';

const members = [
  { id: 'A', name: 'Alice' },
  { id: 'B', name: 'Bob' },
  { id: 'C', name: 'Carol' },
];

// 便於斷言：把回傳交易轉成 "from>to:amount" 的集合
const asSet = (txns) => txns.map(t => `${t.fromId}>${t.toId}:${t.amount}`).sort();

describe('calcSettlement', () => {
  it('空資料應回傳空陣列', () => {
    expect(calcSettlement(members, [], [], { TWD: 1 }, 'TWD')).toEqual([]);
  });

  it('單筆同幣別平分：A 代墊 100、A/B 各分 50 → B 還 A 50', () => {
    const expenses = [
      { paid_by: 'A', amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
    ];
    const result = calcSettlement(members, expenses, [], { TWD: 1 }, 'TWD');
    expect(result).toEqual([
      { fromId: 'B', toId: 'A', from: 'Bob', to: 'Alice', amount: 50 },
    ]);
  });

  it('三人最小化交易：A 代墊 90（三人各 30）→ B→A 30、C→A 30 兩筆', () => {
    const expenses = [
      { paid_by: 'A', amount: 90, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 30 },
        { member_id: 'B', share: 30 },
        { member_id: 'C', share: 30 },
      ] },
    ];
    const result = calcSettlement(members, expenses, [], { TWD: 1 }, 'TWD');
    expect(result).toHaveLength(2);
    expect(asSet(result)).toEqual(['B>A:30', 'C>A:30']);
  });

  it('已還款紀錄應抵銷債務：B 已還 A 50 → 淨額歸零', () => {
    const expenses = [
      { paid_by: 'A', amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
    ];
    const settlements = [
      { from_member: 'B', to_member: 'A', amount: 50, currency: 'TWD' },
    ];
    expect(calcSettlement(members, expenses, settlements, { TWD: 1 }, 'TWD')).toEqual([]);
  });

  it('多幣別換算（結算 TWD）：費用 10 USD、匯率 30 → 應以 TWD 150 結算', () => {
    const expenses = [
      { paid_by: 'A', amount: 10, currency: 'USD', split_expense_shares: [
        { member_id: 'A', share: 5 },
        { member_id: 'B', share: 5 },
      ] },
    ];
    const result = calcSettlement(members, expenses, [], { TWD: 1, USD: 30 }, 'TWD');
    expect(result).toEqual([
      { fromId: 'B', toId: 'A', from: 'Bob', to: 'Alice', amount: 150 },
    ]);
  });

  it('結算幣別非 TWD：費用 300 TWD、結算 USD、匯率 30 → 應以 USD 5 結算', () => {
    const expenses = [
      { paid_by: 'A', amount: 300, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 150 },
        { member_id: 'B', share: 150 },
      ] },
    ];
    const result = calcSettlement(members, expenses, [], { TWD: 1, USD: 30 }, 'USD');
    expect(result).toEqual([
      { fromId: 'B', toId: 'A', from: 'Bob', to: 'Alice', amount: 5 },
    ]);
  });

  it('未知幣別應以匯率 1 fallback，不崩潰', () => {
    const expenses = [
      { paid_by: 'A', amount: 100, currency: 'JPY', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
    ];
    // rates 不含 JPY → factor 用 ?? 1
    const result = calcSettlement(members, expenses, [], { TWD: 1, USD: 30 }, 'TWD');
    expect(result).toEqual([
      { fromId: 'B', toId: 'A', from: 'Bob', to: 'Alice', amount: 50 },
    ]);
  });

  it('殘差小於一分錢應被忽略，不產生微額交易', () => {
    const expenses = [
      { paid_by: 'A', amount: 10, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 9.995 },
        { member_id: 'B', share: 0.005 },
      ] },
    ];
    // A 餘額 +0.005、B 餘額 -0.005，四捨五入後皆不超過門檻 0.01
    expect(calcSettlement(members, expenses, [], { TWD: 1 }, 'TWD')).toEqual([]);
  });

  it('member_id 不在 members 內時，姓名應退回顯示 id', () => {
    const soloMembers = [{ id: 'A', name: 'Alice' }];
    const expenses = [
      { paid_by: 'A', amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
    ];
    const result = calcSettlement(soloMembers, expenses, [], { TWD: 1 }, 'TWD');
    expect(result).toEqual([
      { fromId: 'B', toId: 'A', from: 'B', to: 'Alice', amount: 50 },
    ]);
  });

  it('缺付款人（paid_by 為 null）時不崩潰，且無對應債主 → 無交易', () => {
    const expenses = [
      { paid_by: null, amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
    ];
    expect(calcSettlement(members, expenses, [], { TWD: 1 }, 'TWD')).toEqual([]);
  });

  it('結算幣別匯率為 0 時 factor 退回 1，不產生除以零的 NaN', () => {
    const expenses = [
      { paid_by: 'A', amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
    ];
    const result = calcSettlement(members, expenses, [], { TWD: 1, ZZZ: 0 }, 'ZZZ');
    expect(result).toEqual([
      { fromId: 'B', toId: 'A', from: 'Bob', to: 'Alice', amount: 50 },
    ]);
  });
});
