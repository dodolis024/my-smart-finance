import { describe, it, expect, vi } from 'vitest';
import { equalShares, autoShares, isEqualSplit } from '@/lib/splitShares';

/**
 * 均分的零頭規則。
 *
 * 守的是「會算錯錢但不會報錯」的那一類 bug：除不盡時零頭給誰、
 * 編輯既有費用時有沒有被誤判成均分而把自訂金額沖掉。
 * 最後一組測試直接拿 CLI 的第二份實作對答案——兩邊只要有一邊被改動，
 * 這裡就會紅，不必等使用者發現網頁與 CLI 差一分錢。
 */

describe('equalShares', () => {
  it('除得盡時每個人一樣多', () => {
    expect(equalShares(3000, 3)).toEqual({ base: 1000, first: 1000 });
  });

  it('除不盡時零頭全部給第一位', () => {
    // 100 / 3 = 33.33 * 3 = 99.99，剩下的 0.01 給第一位
    const { base, first } = equalShares(100, 3);
    expect(base).toBe(33.33);
    // first 是 base + 零頭的浮點加總（33.339999999999996），不另外收斂：
    // 這個值只會被送去寫入 split_expense_shares，由 NUMERIC(12,2) 收成 33.34。
    // 需要拿去「顯示」的是 autoShares，那邊才多一次 Math.round——不要為了好看
    // 在這裡補 round，CLI 的 equalShares 沒有補，補了兩邊就分歧了。
    expect(first).toBeCloseTo(33.34, 10);
    expect(Number(first.toFixed(2))).toBe(33.34);
  });

  it('零頭超過一分也整包給第一位，總和仍等於總額', () => {
    const { base, first } = equalShares(10, 7);
    expect(base).toBe(1.42);
    expect(Number((first + base * 6).toFixed(2))).toBe(10);
  });
});

describe('autoShares', () => {
  it('與 equalShares 同規則：零頭給第一位未填的成員', () => {
    expect(autoShares(100, 3)).toEqual({ base: 33.33, first: 33.34 });
  });

  it('剩餘為 0 時所有人都是 0', () => {
    expect(autoShares(0, 2)).toEqual({ base: 0, first: 0 });
  });
});

describe('isEqualSplit', () => {
  it('平均分攤要判為均分', () => {
    const shares = [{ share: 33.34 }, { share: 33.33 }, { share: 33.33 }];
    expect(isEqualSplit(shares, 100)).toBe(true);
  });

  it('使用者喬過的金額不可以被判成均分', () => {
    const shares = [{ share: 50 }, { share: 30 }, { share: 20 }];
    expect(isEqualSplit(shares, 100)).toBe(false);
  });

  it('沒有分攤對象時不算均分', () => {
    expect(isEqualSplit([], 100)).toBe(false);
  });
});

// --- 與 CLI 的第二份實作對答案 ---

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => ({}),
  getCurrentUser: async () => ({ id: 'user-doris' }),
}));

const { equalSharesFor, isEqualSplit: cliIsEqualSplit } = await import('../../tools/core/splitShares.js');

const GROUP = {
  id: 'g1',
  name: '日本行',
  split_members: [
    { id: 'm1', name: 'Doris' },
    { id: 'm2', name: '小明' },
    { id: 'm3', name: '小美' },
  ],
};
const ALL = ['m1', 'm2', 'm3'];

describe('與 tools/core/splitShares.js 保持一致', () => {
  // 挑除不盡、零頭大於一分、小數金額等容易兩邊分歧的數字
  const AMOUNTS = [100, 3000, 10, 0.05, 999.99, 1234.56, 7];

  it.each(AMOUNTS)('金額 %s 均分三人，網頁與 CLI 要算出同樣的數字', (amount) => {
    const { base, first } = equalShares(amount, ALL.length);
    const web = ALL.map((id, i) => ({ member_id: id, share: i === 0 ? first : base }));

    expect(equalSharesFor(GROUP, ALL, amount)).toEqual(web);
  });

  it.each(AMOUNTS)('金額 %s 的均分結果，兩邊都要判為均分', (amount) => {
    const { base, first } = equalShares(amount, ALL.length);
    const shares = [{ share: first }, { share: base }, { share: base }];

    expect(isEqualSplit(shares, amount)).toBe(true);
    expect(cliIsEqualSplit(shares, amount)).toBe(true);
  });
});
