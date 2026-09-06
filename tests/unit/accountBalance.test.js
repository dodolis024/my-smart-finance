import { describe, it, expect } from 'vitest';
import {
  calculateAccountBalance,
  getBalanceSettings,
  hasBalanceTracking,
} from '@/lib/accountBalance';

/**
 * 錢包餘額的算法。這裡守的重點：
 * 1. 餘額只跟著記帳走，沒有任何自動回復
 * 2. 設定時間精確到時分秒——當天稍早的消費不能被重複扣
 * 3. 只認明確的 expense/income，不用「不是收入就當支出」的寫法
 */

const cashAccount = {
  id: 'acc-cash',
  name: '現金',
  type: 'cash',
  balance_amount: 5000,
  balance_as_of: '2026-09-06T14:00:00',
};

const tx = (over) => ({ type: 'expense', paymentMethod: '現金', time: '12:00:00', ...over });

describe('getBalanceSettings', () => {
  it('沒設定餘額的帳戶回傳 null', () => {
    expect(getBalanceSettings({ id: 'a', name: '現金', type: 'cash' })).toBeNull();
    expect(hasBalanceTracking({ id: 'a', name: '現金' })).toBe(false);
  });

  it('餘額設 0 也算有設定（0 元跟沒設過是兩回事）', () => {
    const acc = { ...cashAccount, balance_amount: 0 };
    expect(getBalanceSettings(acc)).not.toBeNull();
    expect(hasBalanceTracking(acc)).toBe(true);
  });

  it('只有金額沒有設定時間時視為未設定（算不出從哪一筆開始扣）', () => {
    expect(getBalanceSettings({ ...cashAccount, balance_as_of: null })).toBeNull();
  });

  it('RPC 的駝峰欄位與資料表的蛇形欄位都吃得到', () => {
    const camel = { id: 'acc-cash', accountName: '現金', balanceAmount: 5000, balanceAsOf: '2026-09-06T14:00:00' };
    expect(getBalanceSettings(camel).initial).toBe(5000);
  });
});

describe('calculateAccountBalance', () => {
  it('沒設定餘額的帳戶回傳 null', () => {
    expect(calculateAccountBalance({ id: 'a', name: '現金' }, [])).toBeNull();
  });

  it('設定之後的支出往下扣、收入往上加', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-06', time: '18:00:00', twdAmount: 300 }),
      tx({ id: 2, date: '2026-09-07', time: '09:00:00', twdAmount: 120 }),
      tx({ id: 3, date: '2026-09-07', time: '10:00:00', twdAmount: 1000, type: 'income' }),
    ]);
    expect(result.spent).toBe(420);
    expect(result.received).toBe(1000);
    expect(result.balance).toBe(5580);
  });

  it('設定時間之前的交易不計入，同一天稍早的消費不會被重複扣', () => {
    const result = calculateAccountBalance(cashAccount, [
      // 當天早上的早餐：數錢包的時候這筆錢已經不在裡面了
      tx({ id: 1, date: '2026-09-06', time: '08:30:00', twdAmount: 60 }),
      // 設定之後才花的
      tx({ id: 2, date: '2026-09-06', time: '20:00:00', twdAmount: 200 }),
    ]);
    expect(result.spent).toBe(200);
    expect(result.balance).toBe(4800);
  });

  it('事後補記的舊帳落在設定時間之前，不會再扣一次', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-08-20', twdAmount: 999 }),
    ]);
    expect(result.spent).toBe(0);
    expect(result.balance).toBe(5000);
  });

  it('別的帳戶的交易不算進來', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-07', paymentMethod: '信用卡', twdAmount: 800 }),
      tx({ id: 2, date: '2026-09-07', account_id: 'acc-other', paymentMethod: null, twdAmount: 700 }),
    ]);
    expect(result.balance).toBe(5000);
  });

  it('用 account_id 對得到的交易也算（直接查資料表拿到的格式）', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-07', account_id: 'acc-cash', paymentMethod: null, twdAmount: 500 }),
    ]);
    expect(result.balance).toBe(4500);
  });

  it('不認識的交易類型不會被當成支出', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-07', type: 'transfer', twdAmount: 5000 }),
    ]);
    expect(result.spent).toBe(0);
    expect(result.balance).toBe(5000);
  });

  it('花超過會顯示負數，不夾在 0', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-07', twdAmount: 5800 }),
    ]);
    expect(result.balance).toBe(-800);
    expect(result.isOverdrawn).toBe(true);
    expect(result.usedPercent).toBe(100);
  });

  it('進度條以「最後一次設定的金額」為滿格', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-07', twdAmount: 1250 }),
    ]);
    expect(result.usedPercent).toBe(25);
  });

  it('跨月不會重來：上個月設定的餘額，這個月照樣一路往下扣', () => {
    const account = { ...cashAccount, balance_as_of: '2026-07-01T00:00:00' };
    const result = calculateAccountBalance(account, [
      tx({ id: 1, date: '2026-07-15', twdAmount: 1000 }),
      tx({ id: 2, date: '2026-08-15', twdAmount: 1000 }),
      tx({ id: 3, date: '2026-09-15', twdAmount: 1000 }),
    ]);
    expect(result.balance).toBe(2000);
  });

  it('沒有 time 的交易當成當天 00:00（舊資料容錯）', () => {
    const account = { ...cashAccount, balance_as_of: '2026-09-06T00:00:00' };
    const result = calculateAccountBalance(account, [
      { type: 'expense', paymentMethod: '現金', date: '2026-09-07', twdAmount: 100 },
    ]);
    expect(result.spent).toBe(100);
  });
});
