import { describe, it, expect } from 'vitest';
import { utcDateString } from '../../supabase/functions/update-exchange-rates/rateHistory.ts';

// 註：utcDateString 以參數傳入 now 且一律走 UTC，
// 因此結果不受執行機器所在時區影響，可穩定重現。

describe('utcDateString', () => {
  it('取的是 UTC 日期，不是機器當地日期', () => {
    // 台北 2026-09-10 07:00，UTC 仍是 09-09；倫敦（BST, UTC+1）是 09-10 00:00。
    // 三個時區三種答案，但表裡只該有 UTC 那一個。
    expect(utcDateString(new Date('2026-09-09T23:00:00Z'))).toBe('2026-09-09');
  });

  it('UTC 午夜是分界，前後一秒分屬兩天', () => {
    expect(utcDateString(new Date('2026-09-09T23:59:59Z'))).toBe('2026-09-09');
    expect(utcDateString(new Date('2026-09-10T00:00:00Z'))).toBe('2026-09-10');
  });

  it('cron 的實際執行時刻（UTC 02:00）落在當天', () => {
    expect(utcDateString(new Date('2026-09-09T02:00:00Z'))).toBe('2026-09-09');
  });
});
