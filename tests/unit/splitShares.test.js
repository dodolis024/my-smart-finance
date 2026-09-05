import { describe, it, expect, vi } from 'vitest';
import {
  splitEqually,
  isEqualSplit,
  remainderOffset,
  shareDecimals,
  shareUnit,
  roundToCurrencyUnit,
  sumMatchesAmount,
  normalizeShares,
  SHARE_SUM_TOLERANCE,
} from '@/lib/splitShares';

/**
 * 分攤規則。
 *
 * 守的是「會算錯錢但不會報錯」的那一類 bug：分攤加總對不回費用金額、
 * 零頭永遠壓在同一個人身上、編輯既有費用時被誤判而把自訂金額沖掉。
 * split_expense_shares 沒有 CHECK 約束，這裡算錯就會在資料庫留下對不平的帳。
 *
 * 最後一組直接拿 CLI 的第二份實作對答案——兩邊只要有一邊被改動就會紅。
 */

const sum = (arr) => Number(arr.reduce((a, b) => a + b, 0).toFixed(2));
const gap = (arr) => Math.max(...arr) - Math.min(...arr);

describe('shareDecimals / shareUnit', () => {
  it('零小數幣別沒有比 1 元更小的單位', () => {
    for (const c of ['TWD', 'JPY', 'KRW']) {
      expect(shareDecimals(c)).toBe(0);
      expect(shareUnit(c)).toBe(1);
    }
  });

  it('其他幣別算到分', () => {
    for (const c of ['USD', 'EUR', 'GBP']) {
      expect(shareDecimals(c)).toBe(2);
      expect(shareUnit(c)).toBe(0.01);
    }
  });

  it('沒指定幣別時當作台幣', () => {
    expect(shareDecimals(undefined)).toBe(0);
  });
});

describe('roundToCurrencyUnit', () => {
  it('台幣收成整數', () => {
    expect(roundToCurrencyUnit(100.5, 'TWD')).toBe(101);
    expect(roundToCurrencyUnit(100.4, 'TWD')).toBe(100);
  });

  it('美金收到分', () => {
    expect(roundToCurrencyUnit(33.336, 'USD')).toBe(33.34);
  });
});

describe('splitEqually', () => {
  it('除得盡時每個人一樣多', () => {
    expect(splitEqually(3000, 3, { currency: 'TWD' })).toEqual([1000, 1000, 1000]);
  });

  it('台幣除不盡時分到整數，任兩人最多差 1 元', () => {
    expect(splitEqually(100, 3, { currency: 'TWD' })).toEqual([34, 33, 33]);
    expect(splitEqually(10, 4, { currency: 'TWD' })).toEqual([3, 3, 2, 2]);
    // 舊規則會變成 [4,1,1,1,1,1,1]，第一位付 4 倍
    expect(splitEqually(10, 7, { currency: 'TWD' })).toEqual([2, 2, 2, 1, 1, 1, 1]);
  });

  it('美金除不盡時分到分', () => {
    expect(splitEqually(100, 3, { currency: 'USD' })).toEqual([33.34, 33.33, 33.33]);
  });

  it('offset 決定零頭從第幾位開始發，但組合不變', () => {
    expect(splitEqually(10, 4, { currency: 'TWD', offset: 0 })).toEqual([3, 3, 2, 2]);
    expect(splitEqually(10, 4, { currency: 'TWD', offset: 1 })).toEqual([2, 3, 3, 2]);
    expect(splitEqually(10, 4, { currency: 'TWD', offset: 3 })).toEqual([3, 2, 2, 3]);
  });

  it('不論金額、人數、幣別、起點，加總都必須等於費用金額且差距不超過一個單位', () => {
    for (const currency of ['TWD', 'JPY', 'USD', 'EUR']) {
      for (const amount of [0.05, 1, 7, 10, 25, 100, 333.33, 999.99, 1234.56, 100000]) {
        for (let count = 1; count <= 9; count++) {
          for (let offset = 0; offset < count; offset++) {
            const shares = splitEqually(amount, count, { currency, offset });
            const expected = roundToCurrencyUnit(amount, currency);
            expect(sumMatchesAmount(sum(shares), expected)).toBe(true);
            expect(gap(shares)).toBeLessThanOrEqual(shareUnit(currency) + SHARE_SUM_TOLERANCE);
          }
        }
      }
    }
  });

  it('沒有參與者時回傳空陣列，不會除以零', () => {
    expect(splitEqually(100, 0, { currency: 'TWD' })).toEqual([]);
  });

  it('零頭不可以帶浮點雜訊', () => {
    // 送進 supabase 的就是這些數字，不能依賴資料庫幫忙收
    expect(String(splitEqually(100, 3, { currency: 'USD' })[0])).toBe('33.34');
    expect(JSON.stringify(splitEqually(1000, 3, { currency: 'USD' }))).toBe('[333.34,333.33,333.33]');
  });
});

describe('remainderOffset', () => {
  it('同一筆費用永遠算出同一個起點', () => {
    const expense = { date: '2026-09-05', title: '晚餐', amount: 100 };
    expect(remainderOffset(expense, 4)).toBe(remainderOffset(expense, 4));
  });

  it('起點一定落在參與者範圍內', () => {
    for (let count = 1; count <= 8; count++) {
      const off = remainderOffset({ date: '2026-09-05', title: '晚餐', amount: 100 }, count);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(count);
    }
  });

  it('不同的費用會輪到不同的人，不會永遠壓在第一位', () => {
    const offsets = new Set(
      ['早餐', '咖啡', '計程車', '門票', '晚餐', '紀念品', '宵夜', '公車'].map((title) =>
        remainderOffset({ date: '2026-09-05', title, amount: 100 }, 4)
      )
    );
    expect(offsets.size).toBeGreaterThan(1);
  });

  it('沒有參與者時回傳 0，不會出現 NaN', () => {
    expect(remainderOffset({ date: '2026-09-05', title: '晚餐', amount: 100 }, 0)).toBe(0);
  });
});

describe('isEqualSplit', () => {
  it('新的整數均分要判為均分', () => {
    expect(isEqualSplit([{ share: 34 }, { share: 33 }, { share: 33 }], 100, 'TWD')).toBe(true);
  });

  it('零頭落在誰身上都算均分', () => {
    expect(isEqualSplit([{ share: 33 }, { share: 34 }, { share: 33 }], 100, 'TWD')).toBe(true);
    expect(isEqualSplit([{ share: 33 }, { share: 33 }, { share: 34 }], 100, 'TWD')).toBe(true);
  });

  it('改制前用小數存的台幣舊資料仍要判為均分', () => {
    // 這條顧的是既有使用者：判錯會讓舊費用在編輯時變成自訂分攤
    expect(isEqualSplit([{ share: 33.34 }, { share: 33.33 }, { share: 33.33 }], 100, 'TWD')).toBe(true);
  });

  it('使用者喬過的金額不可以被判成均分', () => {
    expect(isEqualSplit([{ share: 50 }, { share: 30 }, { share: 20 }], 100, 'TWD')).toBe(false);
    expect(isEqualSplit([{ share: 40 }, { share: 33 }, { share: 27 }], 100, 'TWD')).toBe(false);
  });

  it('美金的均分與自訂也要分得出來', () => {
    expect(isEqualSplit([{ share: 33.34 }, { share: 33.33 }, { share: 33.33 }], 100, 'USD')).toBe(true);
    expect(isEqualSplit([{ share: 40 }, { share: 30 }, { share: 30 }], 100, 'USD')).toBe(false);
  });

  it('沒有分攤對象時不算均分', () => {
    expect(isEqualSplit([], 100, 'TWD')).toBe(false);
  });
});

describe('normalizeShares', () => {
  it('台幣舊資料的小數會被收成整數，且總和仍等於費用金額', () => {
    const result = normalizeShares(
      [{ member_id: 'a', share: 50.5 }, { member_id: 'b', share: 30 }, { member_id: 'c', share: 19.5 }],
      100, 'TWD'
    );

    expect(result.every((s) => Number.isInteger(s.share))).toBe(true);
    expect(result.reduce((sum, s) => sum + s.share, 0)).toBe(100);
  });

  it('外幣的分攤本來就合法，不應該被動到', () => {
    const shares = [{ member_id: 'a', share: 33.34 }, { member_id: 'b', share: 33.33 }, { member_id: 'c', share: 33.33 }];

    expect(normalizeShares(shares, 100, 'USD')).toEqual(shares);
  });

  it('沒有分攤時回傳空陣列', () => {
    expect(normalizeShares([], 100, 'TWD')).toEqual([]);
  });
});

describe('sumMatchesAmount', () => {
  it('剛好相等要通過', () => {
    expect(sumMatchesAmount(100, 100)).toBe(true);
  });

  it('浮點加總的雜訊要吸收掉', () => {
    const total = 0.1 + 0.1 + 0.1;
    expect(total).not.toBe(0.3);
    expect(sumMatchesAmount(total, 0.3)).toBe(true);
  });

  it('差一個最小單位就要擋下來', () => {
    expect(sumMatchesAmount(99.99, 100)).toBe(false);
    expect(sumMatchesAmount(99, 100)).toBe(false);
  });
});

// --- 與 CLI 的第二份實作對答案 ---

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => ({}),
  getCurrentUser: async () => ({ id: 'user-doris' }),
}));

const cli = await import('../../tools/core/splitShares.js');

describe('與 tools/core/splitShares.js 保持一致', () => {
  it('總和容差兩邊必須同值', () => {
    expect(cli.SHARE_SUM_TOLERANCE).toBe(SHARE_SUM_TOLERANCE);
  });

  it('零小數幣別的認定兩邊必須一致', () => {
    for (const c of ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'GBP', undefined]) {
      expect(cli.shareDecimals(c)).toBe(shareDecimals(c));
    }
  });

  it('同一筆費用的輪替起點兩邊必須算出同一個人', () => {
    for (const title of ['早餐', '晚餐', '計程車', 'Dinner']) {
      for (let count = 1; count <= 6; count++) {
        const seed = { date: '2026-09-05', title, amount: 1234.56 };
        expect(cli.remainderOffset(seed, count)).toBe(remainderOffset(seed, count));
      }
    }
  });

  it('同一筆費用的分攤金額兩邊必須完全相同', () => {
    for (const currency of ['TWD', 'JPY', 'USD']) {
      for (const amount of [0.05, 7, 10, 100, 999.99, 1234.56]) {
        for (let count = 1; count <= 7; count++) {
          const offset = remainderOffset({ date: '2026-09-05', title: '晚餐', amount }, count);
          expect(cli.splitEqually(amount, count, { currency, offset }))
            .toEqual(splitEqually(amount, count, { currency, offset }));
        }
      }
    }
  });

  it('舊資料的收斂兩邊必須一致', () => {
    const legacy = [
      { member_id: 'm1', share: 50.5 },
      { member_id: 'm2', share: 30 },
      { member_id: 'm3', share: 19.5 },
    ];
    for (const currency of ['TWD', 'JPY', 'USD']) {
      expect(cli.normalizeShares(legacy, 100, currency))
        .toEqual(normalizeShares(legacy, 100, currency));
    }
  });

  it('均分的判定兩邊必須一致（含台幣舊資料）', () => {
    const cases = [
      [[{ share: 34 }, { share: 33 }, { share: 33 }], 100, 'TWD'],
      [[{ share: 33.34 }, { share: 33.33 }, { share: 33.33 }], 100, 'TWD'],
      [[{ share: 50 }, { share: 30 }, { share: 20 }], 100, 'TWD'],
      [[{ share: 33.34 }, { share: 33.33 }, { share: 33.33 }], 100, 'USD'],
    ];
    for (const [shares, amount, currency] of cases) {
      expect(cli.isEqualSplit(shares, amount, currency)).toBe(isEqualSplit(shares, amount, currency));
    }
  });
});
