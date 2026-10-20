import { describe, it, expect } from 'vitest';
import { ratesStale, lastRateUpdateAt } from '@/lib/rateFreshness';

/**
 * 瀏覽器裡的匯率表在「排程每天 02:00 UTC 更新資料庫」之後就要重抓，
 * 不是固定存 24 小時。否則台灣 9:55 存下的表會用到隔天 9:55，比資料庫晚一整天。
 */
const T = (iso) => new Date(iso).getTime();

describe('lastRateUpdateAt', () => {
  it('02:10 UTC 之後指向今天，之前指向昨天', () => {
    expect(lastRateUpdateAt(T('2026-10-20T02:10:00Z'))).toBe(T('2026-10-20T02:10:00Z'));
    expect(lastRateUpdateAt(T('2026-10-20T23:59:00Z'))).toBe(T('2026-10-20T02:10:00Z'));
    expect(lastRateUpdateAt(T('2026-10-20T02:09:59Z'))).toBe(T('2026-10-19T02:10:00Z'));
    expect(lastRateUpdateAt(T('2026-10-20T00:30:00Z'))).toBe(T('2026-10-19T02:10:00Z'));
  });

  it('跨月跨年也對', () => {
    expect(lastRateUpdateAt(T('2026-03-01T01:00:00Z'))).toBe(T('2026-02-28T02:10:00Z'));
    expect(lastRateUpdateAt(T('2027-01-01T01:00:00Z'))).toBe(T('2026-12-31T02:10:00Z'));
  });
});

describe('ratesStale', () => {
  it('原本的問題：台灣 9:55（01:55 UTC）存的表，10:00 更新後同一天再開就要重抓', () => {
    expect(ratesStale(T('2026-10-20T01:55:00Z'), T('2026-10-20T09:00:00Z'))).toBe(true);
    // 舊規則（固定 24 小時）在這個時間點會說還新鮮
    expect(T('2026-10-20T09:00:00Z') - T('2026-10-20T01:55:00Z') < 24 * 60 * 60 * 1000).toBe(true);
  });

  it('更新之後存的表，到隔天更新前都算新鮮，不多抓', () => {
    const saved = T('2026-10-20T02:15:00Z');
    expect(ratesStale(saved, T('2026-10-20T23:00:00Z'))).toBe(false);
    expect(ratesStale(saved, T('2026-10-21T02:09:00Z'))).toBe(false);
    expect(ratesStale(saved, T('2026-10-21T02:10:00Z'))).toBe(true);
  });

  it('排程還在跑的緩衝期內存下的表，緩衝期一過就算過期', () => {
    const saved = T('2026-10-20T02:05:00Z');
    expect(ratesStale(saved, T('2026-10-20T02:09:00Z'))).toBe(false);
    expect(ratesStale(saved, T('2026-10-20T02:10:00Z'))).toBe(true);
  });

  it('沒存過、或裝置時鐘倒退讓存檔時間在未來，都當過期', () => {
    expect(ratesStale(0, T('2026-10-20T09:00:00Z'))).toBe(true);
    expect(ratesStale(undefined, T('2026-10-20T09:00:00Z'))).toBe(true);
    expect(ratesStale(T('2026-10-21T09:00:00Z'), T('2026-10-20T09:00:00Z'))).toBe(true);
  });

  it('好幾天沒開的 PWA 一定重抓', () => {
    expect(ratesStale(T('2026-10-10T12:00:00Z'), T('2026-10-20T09:00:00Z'))).toBe(true);
  });
});

describe('nextRateUpdateAt / scheduleAtNextRateUpdate', () => {
  it('下一次更新點是最近一次加一天', async () => {
    const { nextRateUpdateAt } = await import('@/lib/rateFreshness');
    expect(nextRateUpdateAt(T('2026-10-20T09:00:00Z'))).toBe(T('2026-10-21T02:10:00Z'));
    expect(nextRateUpdateAt(T('2026-10-20T01:00:00Z'))).toBe(T('2026-10-20T02:10:00Z'));
  });

  it('計時器在下一次更新點叫一次，取消後不叫', async () => {
    const { scheduleAtNextRateUpdate } = await import('@/lib/rateFreshness');
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const now = T('2026-10-20T09:00:00Z');
      vi.setSystemTime(now);
      const cb = vi.fn();
      scheduleAtNextRateUpdate(cb, now);
      vi.advanceTimersByTime(T('2026-10-21T02:10:00Z') - now - 1);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledTimes(1);

      const cb2 = vi.fn();
      const cancel = scheduleAtNextRateUpdate(cb2, Date.now());
      cancel();
      vi.advanceTimersByTime(2 * 24 * 3600 * 1000);
      expect(cb2).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('daysSinceRateUpdate', () => {
  it('整數天、無條件捨去；讀不到回 null', async () => {
    const { daysSinceRateUpdate } = await import('@/lib/rateFreshness');
    const now = T('2026-10-20T09:00:00Z');
    expect(daysSinceRateUpdate('2026-10-17T08:00:00Z', now)).toBe(3);
    expect(daysSinceRateUpdate('2026-10-17T10:00:00Z', now)).toBe(2);
    expect(daysSinceRateUpdate('2026-10-20T08:00:00Z', now)).toBe(0);
    expect(daysSinceRateUpdate(null, now)).toBeNull();
    expect(daysSinceRateUpdate('garbage', now)).toBeNull();
    // 時鐘偏差讓更新時間在未來也不會變負數
    expect(daysSinceRateUpdate('2026-10-21T08:00:00Z', now)).toBe(0);
  });
});
