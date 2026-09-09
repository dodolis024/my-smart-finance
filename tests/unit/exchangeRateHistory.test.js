import { describe, it, expect } from 'vitest';
import { RETENTION_DAYS, utcDateString, retentionCutoff } from '../../supabase/functions/update-exchange-rates/rateHistory.ts';

// 註：這兩個函式都以參數傳入 now 且一律走 UTC，
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

describe('retentionCutoff', () => {
  it('回推指定天數', () => {
    expect(retentionCutoff(new Date('2026-09-09T02:00:00Z'), 400)).toBe('2025-08-05');
  });

  it('跨閏日照樣正確（2028-02-29 在區間內）', () => {
    expect(retentionCutoff(new Date('2029-01-01T02:00:00Z'), 400)).toBe('2027-11-28');
  });

  it('跨年、跨月不會算出不存在的日期', () => {
    expect(retentionCutoff(new Date('2027-03-01T02:00:00Z'), 400)).toBe('2026-01-25');
    // 3/31 往前推一個月，若用「減一個月」的算法會撞到不存在的 2/31
    expect(retentionCutoff(new Date('2026-03-31T02:00:00Z'), 31)).toBe('2026-02-28');
  });

  it('界線當天本身保留：刪除條件是 date < cutoff', () => {
    const now = new Date('2026-09-09T02:00:00Z');
    const cutoff = retentionCutoff(now, 400);
    // 剛好 400 天前的那筆等於 cutoff，不小於 cutoff，所以留著
    expect('2025-08-05' < cutoff).toBe(false);
    // 401 天前的那筆才會被刪
    expect('2025-08-04' < cutoff).toBe(true);
  });

  it('預設用 RETENTION_DAYS，且與明寫 400 同義', () => {
    const now = new Date('2026-09-09T02:00:00Z');
    expect(RETENTION_DAYS).toBe(400);
    expect(retentionCutoff(now)).toBe(retentionCutoff(now, RETENTION_DAYS));
  });
});
