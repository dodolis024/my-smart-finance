import { describe, it, expect } from 'vitest';
import {
  daysInMonth,
  taipeiClock,
  chargeDateToday,
  dedupeRange,
} from '../../supabase/functions/process-subscriptions/schedule.ts';

/**
 * 訂閱自動扣款（process-subscriptions 排程）判斷「今天該不該扣、記在哪天」的日期邏輯。
 * 排程跑在 UTC，扣款日與交易時間要換算成台灣時間；月底與年繳都有邊界。
 * taipeiClock 以參數傳入 now，結果不受執行機器所在時區影響。
 */

const clockOf = (year, month, day) => ({ year, month, day });

describe('taipeiClock', () => {
  it('UTC 16:00 是台灣隔天 00:00', () => {
    expect(taipeiClock(new Date('2026-09-16T16:00:00Z'))).toEqual({ year: 2026, month: 9, day: 17, time: '00:00' });
    expect(taipeiClock(new Date('2026-09-16T15:59:00Z'))).toEqual({ year: 2026, month: 9, day: 16, time: '23:59' });
  });

  it('跨年、跨月都跟著台灣時間走', () => {
    expect(taipeiClock(new Date('2025-12-31T16:30:00Z'))).toEqual({ year: 2026, month: 1, day: 1, time: '00:30' });
    expect(taipeiClock(new Date('2026-02-28T20:05:00Z'))).toEqual({ year: 2026, month: 3, day: 1, time: '04:05' });
  });
});

describe('daysInMonth', () => {
  it('大小月與閏年二月', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe('chargeDateToday：月繳', () => {
  const monthly = (renewal_day) => ({ billing_cycle: 'monthly', renewal_day });

  it('扣款日當天回傳日期，其他天不扣', () => {
    expect(chargeDateToday(monthly(5), clockOf(2026, 9, 5))).toBe('2026-09-05');
    expect(chargeDateToday(monthly(5), clockOf(2026, 9, 4))).toBeNull();
    expect(chargeDateToday(monthly(5), clockOf(2026, 9, 6))).toBeNull();
  });

  it('31 號扣款遇到小月，改在月底扣', () => {
    expect(chargeDateToday(monthly(31), clockOf(2026, 4, 30))).toBe('2026-04-30');
    expect(chargeDateToday(monthly(31), clockOf(2026, 2, 28))).toBe('2026-02-28');
    expect(chargeDateToday(monthly(30), clockOf(2028, 2, 29))).toBe('2028-02-29');
  });

  it('大月不會提早在 30 號扣掉 31 號的訂閱', () => {
    expect(chargeDateToday(monthly(31), clockOf(2026, 8, 30))).toBeNull();
    expect(chargeDateToday(monthly(31), clockOf(2026, 8, 31))).toBe('2026-08-31');
  });

  it('沒填 billing_cycle 的舊資料當月繳', () => {
    expect(chargeDateToday({ billing_cycle: null, renewal_day: 10, renewal_month: 3 }, clockOf(2026, 9, 10))).toBe('2026-09-10');
  });
});

describe('chargeDateToday：年繳', () => {
  const yearly = (renewal_month, renewal_day) => ({ billing_cycle: 'yearly', renewal_month, renewal_day });

  it('只在指定月份的扣款日扣', () => {
    expect(chargeDateToday(yearly(9, 17), clockOf(2026, 9, 17))).toBe('2026-09-17');
    expect(chargeDateToday(yearly(9, 17), clockOf(2026, 10, 17))).toBeNull();
    expect(chargeDateToday(yearly(9, 17), clockOf(2026, 9, 16))).toBeNull();
  });

  it('2/29 扣款遇到平年，改在 2/28 扣', () => {
    expect(chargeDateToday(yearly(2, 29), clockOf(2026, 2, 28))).toBe('2026-02-28');
    expect(chargeDateToday(yearly(2, 29), clockOf(2028, 2, 28))).toBeNull();
    expect(chargeDateToday(yearly(2, 29), clockOf(2028, 2, 29))).toBe('2028-02-29');
  });

  it('缺 renewal_month 一律不扣', () => {
    expect(chargeDateToday(yearly(null, 1), clockOf(2026, 1, 1))).toBeNull();
  });
});

describe('台灣與 UTC 跨日', () => {
  it('排程實際時刻（cron 0 1 * * *，UTC 01:00 = 台灣 09:00）落在同一天', () => {
    expect(taipeiClock(new Date('2026-09-17T01:00:00Z'))).toEqual({ year: 2026, month: 9, day: 17, time: '09:00' });
  });

  it('UTC 還是前一天、台灣已經隔天時，扣的是台灣今天的訂閱', () => {
    // UTC 1/31 16:05 = 台灣 2/1 00:05：該扣 1 號的，不該扣 31 號的
    const clock = taipeiClock(new Date('2026-01-31T16:05:00Z'));
    expect(chargeDateToday({ billing_cycle: 'monthly', renewal_day: 1 }, clock)).toBe('2026-02-01');
    expect(chargeDateToday({ billing_cycle: 'monthly', renewal_day: 31 }, clock)).toBeNull();
  });
});

describe('dedupeRange', () => {
  it('月繳查本月（含當月最後一天）', () => {
    expect(dedupeRange('monthly', 2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(dedupeRange('monthly', 2026, 12)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('年繳查整年', () => {
    expect(dedupeRange('yearly', 2026, 9)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
});
