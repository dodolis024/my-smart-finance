import { describe, it, expect } from 'vitest';
import { calcSettlement, calcMemberTotals, formatSplitAmount } from '@/lib/splitSettlement';

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

describe('calcMemberTotals', () => {
  it('無費用時每位成員總額為 0', () => {
    expect(calcMemberTotals(members, [], { TWD: 1 }, 'TWD')).toEqual({ A: 0, B: 0, C: 0 });
  });

  it('同幣別：各成員加總自己的分攤', () => {
    const expenses = [
      { currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
        { member_id: 'B', share: 50 },
      ] },
      { currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 30 },
      ] },
    ];
    expect(calcMemberTotals(members, expenses, { TWD: 1 }, 'TWD')).toEqual({ A: 80, B: 50, C: 0 });
  });

  it('跨幣別：分攤依匯率換算成群組幣別（USD 31.5 → TWD）', () => {
    const expenses = [
      { currency: 'USD', split_expense_shares: [
        { member_id: 'A', share: 10 },
      ] },
    ];
    expect(calcMemberTotals(members, expenses, { TWD: 1, USD: 31.5 }, 'TWD')).toEqual({ A: 315, B: 0, C: 0 });
  });

  it('member_id 不在 members 內時也計入（與原行為一致）', () => {
    const expenses = [
      { currency: 'TWD', split_expense_shares: [
        { member_id: 'X', share: 20 },
      ] },
    ];
    expect(calcMemberTotals(members, expenses, { TWD: 1 }, 'TWD')).toEqual({ A: 0, B: 0, C: 0, X: 20 });
  });

  it('群組幣別匯率為 0 時 factor 退回 1，不產生 NaN', () => {
    const expenses = [
      { currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 50 },
      ] },
    ];
    expect(calcMemberTotals(members, expenses, { TWD: 1, ZZZ: 0 }, 'ZZZ')).toEqual({ A: 50, B: 0, C: 0 });
  });
});

describe('formatSplitAmount', () => {
  it('零小數幣別（TWD/JPY）不顯示小數', () => {
    expect(formatSplitAmount(1234.56, 'TWD')).toBe('1,235');
    expect(formatSplitAmount(1000, 'JPY')).toBe('1,000');
  });

  it('其他幣別顯示兩位小數', () => {
    expect(formatSplitAmount(1234.5, 'USD')).toBe('1,234.50');
  });

  it('幣別為空時視為 TWD', () => {
    expect(formatSplitAmount(99.4, '')).toBe('99');
  });
});

describe('零小數幣別的結算：收斂到付得出來的面額', () => {
  const rates = { USD: 31.5, TWD: 1 };
  // 美金費用、台幣結算：換匯後每人 1049.895 元，付不出來的零頭要進位
  const usdExpense = [
    { paid_by: 'A', amount: 100, currency: 'USD', split_expense_shares: [
      { member_id: 'A', share: 33.34 },
      { member_id: 'B', share: 33.33 },
      { member_id: 'C', share: 33.33 },
    ] },
  ];

  it('轉帳金額是可以實際交付的整數，且一律往上進位', () => {
    // 每人實欠 1049.895 元，兩位都被要求付到 1050
    const result = calcSettlement(members, usdExpense, [], rates, 'TWD');

    expect(result.map((t) => t.amount)).toEqual([1050, 1050]);
    expect(result.every((t) => Number.isInteger(t.amount))).toBe(true);
  });

  it('代墊的人不可以少收，零頭一律由欠款人吸收', () => {
    const result = calcSettlement(members, usdExpense, [], rates, 'TWD');
    const received = result.reduce((sum, t) => sum + t.amount, 0);
    const owed = (100 - 33.34) * 31.5;

    expect(received).toBeGreaterThanOrEqual(owed);
  });

  it('平了就是平了：多付的不會回頭變成代墊者欠人', () => {
    const suggested = calcSettlement(members, usdExpense, [], rates, 'TWD');
    const paid = suggested.map((t) => ({
      from_member: t.fromId, to_member: t.toId, amount: t.amount, currency: 'TWD',
    }));

    expect(calcSettlement(members, usdExpense, paid, rates, 'TWD')).toEqual([]);
  });

  it('金額被誤記成十倍時仍然要追，不可以被當成湊整的零頭吃掉', () => {
    const paid = [{ from_member: 'B', to_member: 'A', amount: 10500, currency: 'TWD' }];
    const result = calcSettlement(members, usdExpense, paid, rates, 'TWD');

    expect(result.some((t) => t.fromId === 'A' && t.toId === 'B')).toBe(true);
  });

  it('照建議金額付完就全部結清，不會回頭跟人要零頭', () => {
    const suggested = calcSettlement(members, usdExpense, [], rates, 'TWD');
    const paid = suggested.map((t) => ({
      from_member: t.fromId, to_member: t.toId, amount: t.amount, currency: 'TWD',
    }));

    // 多付的 0.21 元當作送給對方——不放寬門檻的話這裡會冒出一筆結不完的零頭
    expect(calcSettlement(members, usdExpense, paid, rates, 'TWD')).toEqual([]);
  });

  it('外幣結算仍然算到分，不進位', () => {
    const result = calcSettlement(members, usdExpense, [], { USD: 1, TWD: 1 }, 'USD');

    expect(result.map((t) => t.amount)).toEqual([33.33, 33.33]);
  });

  it('台幣整數分攤不受進位影響', () => {
    const twd = [
      { paid_by: 'A', amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 34 },
        { member_id: 'B', share: 33 },
        { member_id: 'C', share: 33 },
      ] },
    ];

    expect(calcSettlement(members, twd, [], { TWD: 1 }, 'TWD').map((t) => t.amount)).toEqual([33, 33]);
  });

  it('不到 1 元的真實欠款會被進位成 1 元，代墊者不會白做工', () => {
    const tiny = [
      { paid_by: 'A', amount: 1, currency: 'USD', split_expense_shares: [
        { member_id: 'A', share: 0.5 },
        { member_id: 'B', share: 0.5 },
      ] },
    ];

    // 換匯後 B 只欠 0.01 元，仍然進位成 1 元付給 A
    expect(calcSettlement(members, tiny, [], { USD: 0.02, TWD: 1 }, 'TWD'))
      .toEqual([{ fromId: 'B', toId: 'A', from: 'Bob', to: 'Alice', amount: 1 }]);
  });
});

// --- 與 CLI 的第二份實作對答案 ---

const cliSettlement = await import('../../tools/core/splitSettlement.js');

describe('與 tools/core/splitSettlement.js 保持一致', () => {
  const cases = [
    { label: '台幣整數分攤', currency: 'TWD', rates: { TWD: 1 }, expenses: [
      { paid_by: 'A', amount: 100, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 34 }, { member_id: 'B', share: 33 }, { member_id: 'C', share: 33 },
      ] },
    ] },
    { label: '美金費用換台幣結算', currency: 'TWD', rates: { USD: 31.5, TWD: 1 }, expenses: [
      { paid_by: 'A', amount: 100, currency: 'USD', split_expense_shares: [
        { member_id: 'A', share: 33.34 }, { member_id: 'B', share: 33.33 }, { member_id: 'C', share: 33.33 },
      ] },
    ] },
    { label: '多筆多付款人', currency: 'TWD', rates: { USD: 31.5, TWD: 1 }, expenses: [
      { paid_by: 'A', amount: 1000, currency: 'TWD', split_expense_shares: [
        { member_id: 'A', share: 334 }, { member_id: 'B', share: 333 }, { member_id: 'C', share: 333 },
      ] },
      { paid_by: 'B', amount: 55, currency: 'USD', split_expense_shares: [
        { member_id: 'B', share: 27.5 }, { member_id: 'C', share: 27.5 },
      ] },
    ] },
  ];

  it.each(cases)('$label：網頁與 CLI 要算出同樣的結算方案', ({ currency, rates, expenses }) => {
    expect(cliSettlement.calcSettlement(members, expenses, [], rates, currency))
      .toEqual(calcSettlement(members, expenses, [], rates, currency));
  });

  it.each(cases)('$label：每人總支出兩邊也要一致', ({ currency, rates, expenses }) => {
    expect(cliSettlement.calcMemberTotals(members, expenses, rates, currency))
      .toEqual(calcMemberTotals(members, expenses, rates, currency));
  });
});
