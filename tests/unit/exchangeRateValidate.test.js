import { describe, it, expect } from 'vitest';
import {
  validateRates,
  isStaleRate,
  MAX_CHANGE_PERCENT,
  STALE_AFTER_DAYS,
} from '../../supabase/functions/update-exchange-rates/validate.ts';

/**
 * 匯率 ±20% 防呆的去留判斷（update-exchange-rates/validate.ts）。
 *
 * 重點是「被拒絕的幣別完全不寫」：以前拒絕時仍把舊值連同 updated_at = now() 寫回去，
 * 陳舊放行與首頁徽章都看 updated_at，於是永遠不會觸發，幣別永久鎖在舊值。
 */

const NOW = new Date('2026-10-21T02:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();

function run({ newRates, lastKnownGood = {}, lastUpdatedAt = {} }) {
  return validateRates({ newRates, lastKnownGood, lastUpdatedAt, now: NOW });
}

describe('validateRates', () => {
  it('變動在門檻內 → 採用新值，不算異常', () => {
    const r = run({
      newRates: { TWD: 1, USD: 32.5 },
      lastKnownGood: { TWD: 1, USD: 32 },
      lastUpdatedAt: { TWD: daysAgo(1), USD: daysAgo(1) },
    });
    expect(r.toWrite).toEqual({ TWD: 1, USD: 32.5 });
    expect(r.rejected).toEqual([]);
    expect(r.anomalies).toEqual([]);
    expect(r.decisions.find((d) => d.currency === 'USD').action).toBe('accepted');
  });

  it('剛好 20% 仍採用（門檻是「超過」）', () => {
    const r = run({
      newRates: { USD: 30 * (1 + MAX_CHANGE_PERCENT / 100) },
      lastKnownGood: { USD: 30 },
      lastUpdatedAt: { USD: daysAgo(1) },
    });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.toWrite)).toEqual(['USD']);
  });

  it('超過 20% 且舊值還新鮮 → 拒絕，而且不在寫入清單裡', () => {
    const r = run({
      newRates: { TWD: 1, USD: 40, GBP: 41 },
      lastKnownGood: { TWD: 1, USD: 31.6, GBP: 40 },
      lastUpdatedAt: { TWD: daysAgo(1), USD: daysAgo(1), GBP: daysAgo(1) },
    });
    expect(r.rejected).toEqual(['USD']);
    // 被拒絕的幣別不寫 exchange_rates（updated_at 保持原值）也不寫當天歷史
    expect(r.toWrite).not.toHaveProperty('USD');
    expect(r.toWrite).toEqual({ TWD: 1, GBP: 41 });
    expect(r.anomalies).toEqual([
      { currency: 'USD', oldRate: 31.6, newRate: 40, changePercent: '26.58', action: 'rejected' },
    ]);
  });

  it('超過 20% 但舊值已陳舊 → 放行新值，記為 accepted_stale', () => {
    const staleSince = daysAgo(STALE_AFTER_DAYS + 1);
    const r = run({
      newRates: { USD: 40 },
      lastKnownGood: { USD: 30 },
      lastUpdatedAt: { USD: staleSince },
    });
    expect(r.toWrite).toEqual({ USD: 40 });
    expect(r.rejected).toEqual([]);
    expect(r.anomalies).toEqual([
      { currency: 'USD', oldRate: 30, newRate: 40, changePercent: '33.33', action: 'accepted_stale', staleSince },
    ]);
  });

  it('連續被拒到第 7 天（因為沒寫，updated_at 一路變舊）就會放行', () => {
    const base = { newRates: { USD: 40 }, lastKnownGood: { USD: 30 } };
    // 第 6 天：還在保護期內，照樣拒絕
    expect(run({ ...base, lastUpdatedAt: { USD: daysAgo(6) } }).rejected).toEqual(['USD']);
    // 超過 7 天：舊值不可信，放行
    expect(run({ ...base, lastUpdatedAt: { USD: daysAgo(7.1) } }).toWrite).toEqual({ USD: 40 });
  });

  it('沒有更新時間的舊值當作陳舊 → 放行', () => {
    const r = run({ newRates: { USD: 40 }, lastKnownGood: { USD: 30 } });
    expect(r.toWrite).toEqual({ USD: 40 });
    expect(r.anomalies[0].staleSince).toBeNull();
  });

  it('第一次設定（沒有舊值）→ 直接採用，不算異常', () => {
    const r = run({ newRates: { TWD: 1, KRW: 0.022 }, lastKnownGood: { TWD: 1 } });
    expect(r.toWrite).toEqual({ TWD: 1, KRW: 0.022 });
    expect(r.anomalies).toEqual([]);
    expect(r.decisions.find((d) => d.currency === 'KRW').action).toBe('first_time');
  });

  it('舊值是 0 也當作第一次設定（不能拿 0 當分母）', () => {
    const r = run({ newRates: { USD: 32 }, lastKnownGood: { USD: 0 }, lastUpdatedAt: { USD: daysAgo(1) } });
    expect(r.toWrite).toEqual({ USD: 32 });
  });

  it('TWD 固定 1，不管 API 回什麼', () => {
    const r = run({
      newRates: { TWD: 1.5 },
      lastKnownGood: { TWD: 1 },
      lastUpdatedAt: { TWD: daysAgo(1) },
    });
    expect(r.toWrite).toEqual({ TWD: 1 });
    expect(r.rejected).toEqual([]);
  });
});

describe('isStaleRate', () => {
  it('7 天內不算陳舊', () => {
    expect(isStaleRate(daysAgo(6.9), NOW)).toBe(false);
  });

  it('超過 7 天、沒有時間、時間解析不了 → 陳舊', () => {
    expect(isStaleRate(daysAgo(7.1), NOW)).toBe(true);
    expect(isStaleRate(null, NOW)).toBe(true);
    expect(isStaleRate(undefined, NOW)).toBe(true);
    expect(isStaleRate('not a date', NOW)).toBe(true);
  });
});
