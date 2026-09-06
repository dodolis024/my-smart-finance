import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPeriodRange,
  getPeriodLabel,
  getPeriodFileLabel,
  isCurrentPeriod,
  getCurrentPeriod,
  getPeriodNameKey,
} from '@/lib/period';

// 固定「今天」為 2026-09-06，讓年模式的上限與 isCurrentPeriod 可預期
const TODAY = new Date(2026, 8, 6, 10, 30);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getPeriodRange 年模式', () => {
  it('選當年度時結束日是今天，不含之後手動記的未來交易', () => {
    expect(getPeriodRange({ granularity: 'year', year: 2026 })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-09-06',
    });
  });

  it('選過去年份時是完整一整年', () => {
    expect(getPeriodRange({ granularity: 'year', year: 2024 })).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });
  });
});

describe('getPeriodRange 月模式', () => {
  it('31 天的月份', () => {
    expect(getPeriodRange({ granularity: 'month', year: 2026, month: 1 })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
  });

  it('平年 2 月是 28 天', () => {
    expect(getPeriodRange({ granularity: 'month', year: 2026, month: 2 })).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
  });

  it('閏年 2 月是 29 天', () => {
    expect(getPeriodRange({ granularity: 'month', year: 2024, month: 2 })).toEqual({
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });

  it('30 天的月份，月份補零', () => {
    expect(getPeriodRange({ granularity: 'month', year: 2026, month: 4 })).toEqual({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });
  });

  it('當月不以今天為上限（維持整月，與現況一致）', () => {
    expect(getPeriodRange({ granularity: 'month', year: 2026, month: 9 })).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
  });
});

describe('getPeriodLabel / getPeriodFileLabel', () => {
  it('月模式沿用既有的 Sep 2026 格式', () => {
    expect(getPeriodLabel({ granularity: 'month', year: 2026, month: 9 })).toBe('Sep 2026');
    expect(getPeriodLabel({ granularity: 'month', year: 2026, month: 1 })).toBe('Jan 2026');
  });

  it('年模式只顯示年份', () => {
    expect(getPeriodLabel({ granularity: 'year', year: 2026 })).toBe('2026');
  });

  it('檔名標籤：月為 YYYY-MM、年為 YYYY', () => {
    expect(getPeriodFileLabel({ granularity: 'month', year: 2026, month: 4 })).toBe('2026-04');
    expect(getPeriodFileLabel({ granularity: 'year', year: 2026 })).toBe('2026');
  });
});

describe('isCurrentPeriod', () => {
  it('月模式只有今天所在的年月才是 true', () => {
    expect(isCurrentPeriod({ granularity: 'month', year: 2026, month: 9 })).toBe(true);
    expect(isCurrentPeriod({ granularity: 'month', year: 2026, month: 8 })).toBe(false);
    expect(isCurrentPeriod({ granularity: 'month', year: 2025, month: 9 })).toBe(false);
  });

  it('年模式只看年份', () => {
    expect(isCurrentPeriod({ granularity: 'year', year: 2026 })).toBe(true);
    expect(isCurrentPeriod({ granularity: 'year', year: 2025 })).toBe(false);
  });
});

describe('getCurrentPeriod', () => {
  it('回傳今天所在的期間', () => {
    expect(getCurrentPeriod('month')).toEqual({ granularity: 'month', year: 2026, month: 9 });
    expect(getCurrentPeriod('year')).toEqual({ granularity: 'year', year: 2026 });
  });
});

describe('getPeriodNameKey', () => {
  it('對應到 locales 的 dashboard.period.*', () => {
    expect(getPeriodNameKey('month')).toBe('dashboard.period.month');
    expect(getPeriodNameKey('year')).toBe('dashboard.period.year');
  });
});
