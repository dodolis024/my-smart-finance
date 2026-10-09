import { describe, it, expect } from 'vitest';
import {
  calculateAccountBalance,
  getBalanceSettings,
  getBalanceCurrency,
  hasBalanceTracking,
  formatBalanceMoney,
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

  it('和設定餘額同一分鐘記的帳要扣（交易時間只到分，設定時間到秒）', () => {
    // 18:30:15 設定，同一分鐘記的帳存成 18:30:00；逐秒比會被當成設定之前而漏扣
    const account = { ...cashAccount, balance_as_of: '2026-09-06T18:30:15' };
    const result = calculateAccountBalance(account, [
      tx({ id: 1, date: '2026-09-06', time: '18:30:00', twdAmount: 100 }),
      // 前一分鐘的仍算設定之前
      tx({ id: 2, date: '2026-09-06', time: '18:29:00', twdAmount: 999 }),
    ]);
    expect(result.spent).toBe(100);
    expect(result.balance).toBe(4900);
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

describe('餘額的幣別', () => {
  // 英鎊錢包：設定 100 鎊。匯率語意同全站：1 英鎊 = 多少台幣
  const gbpWallet = { ...cashAccount, balance_amount: 100, balance_currency: 'GBP' };
  const gbpRates = { history: [['2026-09-01', 40], ['2026-09-07', 41]], live: 42 };

  it('沒有幣別欄位的舊帳戶當台幣，駝峰與蛇形都吃得到', () => {
    expect(getBalanceCurrency(cashAccount)).toBe('TWD');
    expect(getBalanceCurrency({ balance_currency: null })).toBe('TWD');
    expect(getBalanceCurrency({ balanceCurrency: 'gbp' })).toBe('GBP');
    expect(calculateAccountBalance(cashAccount, []).currency).toBe('TWD');
  });

  it('英鎊錢包付英鎊的帳：扣英鎊，不是扣換算後的台幣', () => {
    // 花 5 鎊，記帳當時匯率 41 → twd_amount 205；舊版會從 100 扣掉 205
    const result = calculateAccountBalance(gbpWallet, [
      tx({ id: 1, date: '2026-09-07', currency: 'GBP', originalAmount: 5, exchangeRate: 41, twdAmount: 205 }),
    ], gbpRates);
    expect(result.currency).toBe('GBP');
    expect(result.spent).toBeCloseTo(5);
    expect(result.balance).toBeCloseTo(95);
  });

  it('英鎊錢包只有英鎊交易時，匯率表還沒載入也算得出來（只用交易自己凍結的匯率）', () => {
    const result = calculateAccountBalance(gbpWallet, [
      tx({ id: 1, date: '2026-09-07', currency: 'GBP', originalAmount: 5, exchangeRate: 41, twdAmount: 205 }),
    ], null);
    expect(result.ratesPending).toBe(false);
    expect(result.balance).toBeCloseTo(95);
  });

  it('英鎊錢包付台幣的帳：依交易當天的匯率換成英鎊', () => {
    const result = calculateAccountBalance(gbpWallet, [
      // 9/7 的匯率是 41：410 台幣 = 10 鎊
      tx({ id: 1, date: '2026-09-07', currency: 'TWD', originalAmount: 410, exchangeRate: 1, twdAmount: 410 }),
    ], gbpRates);
    expect(result.spent).toBeCloseTo(10);
    expect(result.balance).toBeCloseTo(90);
  });

  it('英鎊錢包付日圓的帳：經由台幣換成英鎊', () => {
    const result = calculateAccountBalance(gbpWallet, [
      tx({ id: 1, date: '2026-09-07', currency: 'JPY', originalAmount: 2000, exchangeRate: 0.205, twdAmount: 410 }),
    ], gbpRates);
    expect(result.spent).toBeCloseTo(10);
  });

  it('台幣錢包付英鎊的帳：扣這筆換算好的台幣（記帳當時凍結的匯率）', () => {
    const result = calculateAccountBalance(cashAccount, [
      tx({ id: 1, date: '2026-09-07', currency: 'GBP', originalAmount: 5, exchangeRate: 41, twdAmount: 205 }),
    ]);
    expect(result.currency).toBe('TWD');
    expect(result.spent).toBe(205);
    expect(result.balance).toBe(4795);
  });

  it('收入也換成帳戶幣別往上加', () => {
    const result = calculateAccountBalance(gbpWallet, [
      tx({ id: 1, date: '2026-09-07', type: 'income', currency: 'TWD', originalAmount: 820, exchangeRate: 1, twdAmount: 820 }),
    ], gbpRates);
    expect(result.received).toBeCloseTo(20);
    expect(result.balance).toBeCloseTo(120);
  });

  it('需要換算卻沒有匯率：不顯示數字（ratesPending），絕不拿台幣冒充', () => {
    const result = calculateAccountBalance(gbpWallet, [
      tx({ id: 1, date: '2026-09-07', currency: 'TWD', originalAmount: 410, exchangeRate: 1, twdAmount: 410 }),
    ], null);
    expect(result.ratesPending).toBe(true);
    expect(result.balance).toBeNull();
  });

  it('設定時間之前的跨幣別交易不需要匯率，也不會卡住', () => {
    const result = calculateAccountBalance(gbpWallet, [
      tx({ id: 1, date: '2026-08-01', currency: 'TWD', originalAmount: 410, exchangeRate: 1, twdAmount: 410 }),
    ], null);
    expect(result.ratesPending).toBe(false);
    expect(result.balance).toBe(100);
  });

  it('金額格式：台幣維持整數，其他幣別用該幣別的符號與小數位', () => {
    expect(formatBalanceMoney(4795, 'TWD')).toBe(formatBalanceMoney(4795));
    expect(formatBalanceMoney(95, 'GBP')).toMatch(/£\s?95\.00/);
  });
});
