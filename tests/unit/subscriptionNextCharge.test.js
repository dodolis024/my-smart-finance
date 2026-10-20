import { describe, it, expect } from 'vitest';
import { nextChargeDate, taipeiClock, chargeDateToday } from '@/lib/subscriptionSchedule';
import {
  taipeiClock as edgeTaipeiClock,
  chargeDateToday as edgeChargeDateToday,
} from '../../supabase/functions/process-subscriptions/schedule.ts';

/**
 * 前端新增訂閱時的「今天是不是扣款日」要和排程端給出一樣的答案，
 * 否則同一筆訂閱可能兩邊都不入帳。這裡直接拿兩份實作對撞，不信任各自的註解。
 */
describe('taipeiClock / chargeDateToday 與排程端同語意', () => {
  const nows = [
    '2026-09-16T16:00:00Z', '2026-09-16T15:59:00Z', '2025-12-31T16:30:00Z',
    '2026-02-28T20:05:00Z', '2026-04-30T03:00:00Z', '2028-02-29T10:00:00Z',
  ];
  const subs = [
    { billing_cycle: 'monthly', renewal_day: 1 },
    { billing_cycle: 'monthly', renewal_day: 17 },
    { billing_cycle: 'monthly', renewal_day: 31 },
    { billing_cycle: 'yearly', renewal_month: 3, renewal_day: 1 },
    { billing_cycle: 'yearly', renewal_month: 2, renewal_day: 30 },
    { renewal_day: 30 },
  ];

  it('台灣時鐘逐點相同', () => {
    for (const n of nows) expect(taipeiClock(new Date(n))).toEqual(edgeTaipeiClock(new Date(n)));
  });

  it('扣款日判定逐組相同（含月底與年繳）', () => {
    for (const n of nows) {
      const clock = taipeiClock(new Date(n));
      for (const sub of subs) expect(chargeDateToday(sub, clock)).toBe(edgeChargeDateToday(sub, clock));
    }
  });

  it('31 號在 4/30 台灣時間當天要扣', () => {
    expect(chargeDateToday({ renewal_day: 31 }, taipeiClock(new Date('2026-04-30T03:00:00Z')))).toBe('2026-04-30');
    expect(chargeDateToday({ renewal_day: 31 }, taipeiClock(new Date('2026-04-30T16:30:00Z')))).toBeNull();
  });
});

/**
 * 訂閱列表顯示的「下次扣款日」。跟排程端同一套月底規則：
 * 扣款日超過當月天數就落在月底，不跳到下個月。
 */
describe('nextChargeDate — 月繳', () => {
  it('扣款日還沒到就是本月', () => {
    expect(nextChargeDate({ renewal_day: 15 }, '2026-10-03')).toBe('2026-10-15');
  });

  it('今天剛好是扣款日就顯示今天', () => {
    expect(nextChargeDate({ renewal_day: 15 }, '2026-10-15')).toBe('2026-10-15');
  });

  it('過了就跳下個月', () => {
    expect(nextChargeDate({ renewal_day: 15 }, '2026-10-16')).toBe('2026-11-15');
  });

  it('31 號遇到小月改在月底，不跳過', () => {
    expect(nextChargeDate({ renewal_day: 31 }, '2026-04-01')).toBe('2026-04-30');
    expect(nextChargeDate({ renewal_day: 31 }, '2026-02-01')).toBe('2026-02-28');
    expect(nextChargeDate({ renewal_day: 30 }, '2028-02-01')).toBe('2028-02-29');
  });

  it('月底已過時下個月也要套同一套夾法', () => {
    // 1/31 過了 → 2 月沒有 31 號 → 2/28
    expect(nextChargeDate({ renewal_day: 31 }, '2026-01-31')).toBe('2026-01-31');
    expect(nextChargeDate({ renewal_day: 31 }, '2026-02-01')).toBe('2026-02-28');
  });

  it('12 月過了跨到明年 1 月', () => {
    expect(nextChargeDate({ renewal_day: 5, billing_cycle: 'monthly' }, '2026-12-20')).toBe('2027-01-05');
  });
});

describe('nextChargeDate — 年繳', () => {
  it('今年還沒到就是今年', () => {
    expect(nextChargeDate({ billing_cycle: 'yearly', renewal_month: 11, renewal_day: 1 }, '2026-10-19')).toBe('2026-11-01');
  });

  it('今年已過就是明年，月底規則照套', () => {
    expect(nextChargeDate({ billing_cycle: 'yearly', renewal_month: 2, renewal_day: 29 }, '2026-10-19')).toBe('2027-02-28');
  });

  it('缺月份回 null，呼叫端不顯示', () => {
    expect(nextChargeDate({ billing_cycle: 'yearly', renewal_day: 1 }, '2026-10-19')).toBeNull();
  });
});

describe('nextChargeDate — 壞輸入', () => {
  it('扣款日不合法或今天格式壞掉時回 null，不丟錯', () => {
    expect(nextChargeDate({ renewal_day: 0 }, '2026-10-19')).toBeNull();
    expect(nextChargeDate({ renewal_day: NaN }, '2026-10-19')).toBeNull();
    expect(nextChargeDate({ renewal_day: 5 }, 'garbage')).toBeNull();
  });
});
