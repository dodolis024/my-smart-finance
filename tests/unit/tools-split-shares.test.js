import { describe, it, expect, vi } from 'vitest';

/**
 * 分攤語法解析。
 *
 * 這裡守的是「會算錯錢但不會報錯」的那一類 bug：零頭給誰、混合寫法剩多少、
 * 名字對不上時有沒有被默默忽略。尤其是零頭——網頁與 CLI 若給不同的人，
 * 同一筆帳兩邊會差一分錢，而且只在除不盡時出現。
 */

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => ({}),
  getCurrentUser: async () => ({ id: 'user-doris' }),
}));

const { parseSplitSpec, equalSharesFor, isEqualSplit } = await import('../../tools/core/splitShares.js');

// 成員順序 = created_at 順序 = 零頭歸屬的依據
const GROUP = {
  id: 'g1',
  name: '日本行',
  currency: 'TWD',
  split_members: [
    { id: 'm1', name: 'Doris', user_id: 'user-doris' },
    { id: 'm2', name: '小明', user_id: null },
    { id: 'm3', name: '小美', user_id: null },
  ],
};

function shareOf(result, memberId) {
  return result.find((s) => s.member_id === memberId)?.share;
}

describe('parseSplitSpec', () => {
  it('省略 --split 就是全體成員均分', async () => {
    const result = await parseSplitSpec({ spec: undefined, amount: 3000, group: GROUP });

    expect(result).toEqual([
      { member_id: 'm1', share: 1000 },
      { member_id: 'm2', share: 1000 },
      { member_id: 'm3', share: 1000 },
    ]);
  });

  it('除不盡時零頭給成員順序中的第一位', async () => {
    const result = await parseSplitSpec({ spec: '', amount: 1000, group: GROUP });

    expect(shareOf(result, 'm1')).toBeCloseTo(333.34, 10);
    expect(shareOf(result, 'm2')).toBeCloseTo(333.33, 10);
    expect(shareOf(result, 'm3')).toBeCloseTo(333.33, 10);
  });

  it('打亂 --split 的書寫順序，零頭歸屬不變', async () => {
    const written = await parseSplitSpec({ spec: '小美,小明,Doris', amount: 1000, group: GROUP });

    // 依成員順序回傳，且拿到零頭的仍是 Doris——agent 換個寫法不該換人多付一分錢
    expect(written.map((s) => s.member_id)).toEqual(['m1', 'm2', 'm3']);
    expect(shareOf(written, 'm1')).toBeCloseTo(333.34, 10);
    expect(shareOf(written, 'm3')).toBeCloseTo(333.33, 10);
  });

  it('指定部分成員時只有他們均分', async () => {
    const result = await parseSplitSpec({ spec: '小明,小美', amount: 900, group: GROUP });

    expect(result).toEqual([
      { member_id: 'm2', share: 450 },
      { member_id: 'm3', share: 450 },
    ]);
  });

  it('混合寫法：有等號的固定，其餘均分剩下的', async () => {
    const result = await parseSplitSpec({ spec: 'Doris=200,小明,小美', amount: 1000, group: GROUP });

    expect(shareOf(result, 'm1')).toBe(200);
    expect(shareOf(result, 'm2')).toBeCloseTo(400, 10);
    expect(shareOf(result, 'm3')).toBeCloseTo(400, 10);
  });

  it('混合寫法除不盡時，零頭給第一位待分配的成員', async () => {
    const result = await parseSplitSpec({ spec: 'Doris=100,小明,小美', amount: 1000.01, group: GROUP });

    expect(shareOf(result, 'm1')).toBe(100);
    expect(shareOf(result, 'm2')).toBeCloseTo(450.01, 10);
    expect(shareOf(result, 'm3')).toBeCloseTo(450, 10);
  });

  it('固定金額容許千分位逗號', async () => {
    const result = await parseSplitSpec({ spec: 'Doris=1000,小明=2000', amount: 3000, group: GROUP });

    expect(shareOf(result, 'm1')).toBe(1000);
    expect(shareOf(result, 'm2')).toBe(2000);
  });

  it('全部固定但總和與金額差超過 0.02 要報錯，並寫出總和與應為金額', async () => {
    await expect(
      parseSplitSpec({ spec: 'Doris=300,小明=500', amount: 1000, group: GROUP })
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('800.00'),
    });
  });

  it('全部固定但總和差一分錢要擋下', async () => {
    // 333.33 * 3 = 999.99。舊的 0.02 容差會放行，讓分攤加總與費用金額對不起來；
    // split_expense_shares 沒有 CHECK 約束，這裡放行就沒有人擋了。
    await expect(
      parseSplitSpec({ spec: 'Doris=333.33,小明=333.33,小美=333.33', amount: 1000, group: GROUP })
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('999.99'),
    });
  });

  it('全部固定且剛好等於總額才通過', async () => {
    const result = await parseSplitSpec({ spec: 'Doris=333.34,小明=333.33,小美=333.33', amount: 1000, group: GROUP });

    expect(result).toEqual([
      { member_id: 'm1', share: 333.34 },
      { member_id: 'm2', share: 333.33 },
      { member_id: 'm3', share: 333.33 },
    ]);
  });

  it('固定金額超過總額要報錯', async () => {
    await expect(
      parseSplitSpec({ spec: 'Doris=1200,小明', amount: 1000, group: GROUP })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('超過總額') });
  });

  it('負數的固定分攤要擋下', async () => {
    await expect(
      parseSplitSpec({ spec: 'Doris=-100,小明', amount: 1000, group: GROUP })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('成員名稱對不上要報錯，hint 要列出成員名單', async () => {
    await expect(
      parseSplitSpec({ spec: 'Doris,小華', amount: 1000, group: GROUP })
    ).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
      hint: expect.stringContaining('小明'),
    });
  });

  it('重複指定同一位成員要報錯', async () => {
    await expect(
      parseSplitSpec({ spec: 'Doris,Doris,小明', amount: 900, group: GROUP })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('重複') });
  });

  it('me / 我 / 自己 解析成登入者連結的成員', async () => {
    for (const alias of ['me', 'ME', '我', '自己']) {
      const result = await parseSplitSpec({ spec: `${alias},小明`, amount: 1000, group: GROUP });
      expect(result.map((s) => s.member_id)).toEqual(['m1', 'm2']);
    }
  });

  it('群組裡真的有成員叫「我」時，成員名優先', async () => {
    const group = {
      ...GROUP,
      split_members: [{ id: 'm9', name: '我', user_id: null }, ...GROUP.split_members],
    };
    const result = await parseSplitSpec({ spec: '我', amount: 500, group });

    expect(result).toEqual([{ member_id: 'm9', share: 500 }]);
  });

  it('登入者在群組沒有連結成員時，用「我」要報錯並提示 --paid-by', async () => {
    const group = { ...GROUP, split_members: GROUP.split_members.map((m) => ({ ...m, user_id: null })) };

    await expect(parseSplitSpec({ spec: 'me', amount: 100, group })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('--paid-by'),
    });
  });
});

describe('isEqualSplit（edit 改金額時判斷原分攤是不是均分）', () => {
  it('均分（含零頭）判定為均分', () => {
    expect(isEqualSplit([{ share: 333.34 }, { share: 333.33 }, { share: 333.33 }], 1000)).toBe(true);
  });

  it('使用者喬過的自訂金額不會被當成均分', () => {
    expect(isEqualSplit([{ share: 600 }, { share: 200 }, { share: 200 }], 1000)).toBe(false);
  });
});

describe('equalSharesFor', () => {
  it('依群組成員順序排列，零頭給第一位', () => {
    const result = equalSharesFor(GROUP, ['m3', 'm2'], 1000);

    expect(result).toEqual([
      { member_id: 'm2', share: 500 },
      { member_id: 'm3', share: 500 },
    ]);
  });
});
