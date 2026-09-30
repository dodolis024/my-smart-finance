import { describe, it, expect } from 'vitest';
import { sortAccountsByOrder } from '@/lib/accountOrder';

const names = (list) => list.map((a) => a.name);

// 資料來源（RPC 與設定頁查詢）一律按 created_at，所以未排序的輸入就是建立順序
const accounts = [
  { id: 'a', name: '現金' },
  { id: 'b', name: '國泰卡' },
  { id: 'c', name: '悠遊卡' },
];

describe('sortAccountsByOrder', () => {
  it('照使用者排好的順序排列', () => {
    expect(names(sortAccountsByOrder(accounts, ['c', 'a', 'b']))).toEqual(['悠遊卡', '現金', '國泰卡']);
  });

  it('沒有順序設定時原封不動', () => {
    expect(sortAccountsByOrder(accounts, [])).toBe(accounts);
    expect(sortAccountsByOrder(accounts, null)).toBe(accounts);
  });

  it('排序之後才新增的帳戶接在最後，並維持建立順序', () => {
    const withNew = [...accounts, { id: 'd', name: '玉山卡' }, { id: 'e', name: '街口' }];
    // 兩個新帳戶都不在順序裡：Infinity - Infinity 是 NaN，沒擋掉就會排出不可預測的結果
    expect(names(sortAccountsByOrder(withNew, ['b', 'a', 'c'])))
      .toEqual(['國泰卡', '現金', '悠遊卡', '玉山卡', '街口']);
  });

  it('順序裡有已刪除的帳戶時不影響其餘排序', () => {
    expect(names(sortAccountsByOrder(accounts, ['zzz', 'c', 'b', 'a'])))
      .toEqual(['悠遊卡', '國泰卡', '現金']);
  });

  it('不改動傳入的陣列', () => {
    const input = [...accounts];
    sortAccountsByOrder(input, ['c', 'b', 'a']);
    expect(names(input)).toEqual(['現金', '國泰卡', '悠遊卡']);
  });
});
