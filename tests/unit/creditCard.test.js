import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateCreditUsage, getBillingCycleRange } from '@/lib/creditCard';

describe('getBillingCycleRange', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('無帳單日時應回傳 null', () => {
    expect(getBillingCycleRange({ id: 'acc1', name: '卡1' })).toBeNull();
  });

  it('一般情況：帳單日 5，今日 2/27', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-27'));
    const cycle = getBillingCycleRange({ billing_day: 5 });
    expect(cycle).toEqual({
      prevBillingDate: '2026-01-05',
      lastBillingDate: '2026-02-05',
      lastBillingEndDate: '2026-02-04',
      todayDate: '2026-02-27',
    });
  });

  it('帳單日 31 遇小月應夾在月底，而非組出不存在的日期', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15'));
    const cycle = getBillingCycleRange({ billing_day: 31 });
    // 2 月沒有 31 日 → 夾到 2/28
    expect(cycle).toEqual({
      prevBillingDate: '2026-01-31',
      lastBillingDate: '2026-02-28',
      lastBillingEndDate: '2026-02-27',
      todayDate: '2026-03-15',
    });
  });

  it('跨年：帳單日 15，今日 1/10', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10'));
    const cycle = getBillingCycleRange({ billingDay: 15 });
    expect(cycle).toEqual({
      prevBillingDate: '2025-11-15',
      lastBillingDate: '2025-12-15',
      lastBillingEndDate: '2025-12-14',
      todayDate: '2026-01-10',
    });
  });

  it('帳單日 1：上一期截止日應為前一個月的最後一天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20'));
    const cycle = getBillingCycleRange({ billing_day: 1 });
    expect(cycle).toEqual({
      prevBillingDate: '2026-02-01',
      lastBillingDate: '2026-03-01',
      lastBillingEndDate: '2026-02-28',
      todayDate: '2026-03-20',
    });
  });
});

describe('calculateCreditUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-27')); // 27 日
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('無帳單日時應回傳 0', () => {
    const account = { id: 'acc1', name: '卡1' };
    const history = [{ type: 'expense', date: '2026-02-20', twdAmount: 1000, account_id: 'acc1' }];
    expect(calculateCreditUsage(account, history)).toBe(0);
  });

  it('空 history 時應回傳 0', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5 };
    expect(calculateCreditUsage(account, [])).toBe(0);
  });

  it('應只計算 expense 類型交易', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5 };
    const history = [
      { type: 'income', date: '2026-02-10', twdAmount: 5000, account_id: 'acc1' },
      { type: 'expense', date: '2026-02-10', twdAmount: 1000, account_id: 'acc1' },
    ];
    expect(calculateCreditUsage(account, history)).toBe(1000);
  });

  it('應只計算符合 account_id 或 paymentMethod 的交易', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5 };
    const history = [
      { type: 'expense', date: '2026-02-10', twdAmount: 1000, account_id: 'acc1' },
      { type: 'expense', date: '2026-02-10', twdAmount: 500, paymentMethod: '卡1' },
      { type: 'expense', date: '2026-02-10', twdAmount: 200, account_id: 'other' },
    ];
    expect(calculateCreditUsage(account, history)).toBe(1500);
  });

  it('應計算當前帳單週期內的消費（帳單日 5，今日 27）', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5 };
    const history = [
      { type: 'expense', date: '2026-02-06', twdAmount: 1000, account_id: 'acc1' },
      { type: 'expense', date: '2026-02-20', twdAmount: 500, account_id: 'acc1' },
      { type: 'expense', date: '2026-02-26', twdAmount: 300, account_id: 'acc1' },
    ];
    expect(calculateCreditUsage(account, history)).toBe(1800);
  });

  it('應支援 billingDay / paymentDueDay 駝峰命名', () => {
    const account = { id: 'acc1', accountName: '卡1', billingDay: 5 };
    const history = [{ type: 'expense', date: '2026-02-10', twdAmount: 500, account_id: 'acc1' }];
    expect(calculateCreditUsage(account, history)).toBe(500);
  });

  it('history 為 null 或 undefined 時不應報錯', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5 };
    expect(calculateCreditUsage(account, null)).toBe(0);
    expect(calculateCreditUsage(account, undefined)).toBe(0);
  });
});

describe('calculateCreditUsage — hasPaid 判定在小月應夾取，不與大月互相影響', () => {
  // 這組測試改用第三參數 today 直接注入日期，不依賴 fake timers。

  it('小月（2 月）繳款日 31 應夾到月底（28），2/28 當天視為已繳款，上一期消費不列入使用率', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5, payment_due_day: 31 };
    const history = [
      // 上一期（1/05 ~ 2/04）：修正前 hasPaid 誤判為 false，這筆會被誤算進使用率
      { type: 'expense', date: '2026-01-10', twdAmount: 1000, account_id: 'acc1' },
      // 本期（2/05 ~ 2/28）：不論 hasPaid 為何都應計入
      { type: 'expense', date: '2026-02-10', twdAmount: 200, account_id: 'acc1' },
    ];
    const today = new Date(2026, 1, 28); // 2026-02-28
    expect(calculateCreditUsage(account, history, today)).toBe(200);
  });

  it('大月（3 月）繳款日 31 對照組：3/31 當天行為與夾取前一致（已繳款、上一期不列入）', () => {
    const account = { id: 'acc1', name: '卡1', billing_day: 5, payment_due_day: 31 };
    const history = [
      // 上一期（2/05 ~ 3/04）
      { type: 'expense', date: '2026-02-10', twdAmount: 1000, account_id: 'acc1' },
      // 本期（3/05 ~ 3/31）
      { type: 'expense', date: '2026-03-10', twdAmount: 300, account_id: 'acc1' },
    ];
    const today = new Date(2026, 2, 31); // 2026-03-31
    expect(calculateCreditUsage(account, history, today)).toBe(300);
  });
});
