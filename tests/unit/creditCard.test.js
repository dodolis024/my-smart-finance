import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateCreditUsage } from '@/lib/creditCard';

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
