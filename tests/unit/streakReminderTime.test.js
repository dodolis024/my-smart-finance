import { describe, it, expect } from 'vitest';
import { isReminderTime, getUserToday } from '../../supabase/functions/send-streak-reminder/reminderTime.ts';

// 註：這些函式以參數傳入 now，且只擷取「目標時區」的時/分/日，
// 因此測試結果不受執行機器所在時區影響，可穩定重現。

describe('isReminderTime', () => {
  // 2026-07-07T12:00:00Z：台北（UTC+8）當地為 20:00
  const nowTaipei20 = new Date('2026-07-07T12:00:00Z');

  it('準點命中：台北當地 20:00，提醒設定 20:00 → true', () => {
    expect(isReminderTime(nowTaipei20, 'Asia/Taipei', '20:00')).toBe(true);
  });

  it('±2 分容差內視為命中：20:02 → true、19:58 → true', () => {
    expect(isReminderTime(nowTaipei20, 'Asia/Taipei', '20:02')).toBe(true);
    expect(isReminderTime(nowTaipei20, 'Asia/Taipei', '19:58')).toBe(true);
  });

  it('超過 ±2 分不命中：20:03 → false、19:57 → false', () => {
    expect(isReminderTime(nowTaipei20, 'Asia/Taipei', '20:03')).toBe(false);
    expect(isReminderTime(nowTaipei20, 'Asia/Taipei', '19:57')).toBe(false);
  });

  it('跨午夜：台北當地 23:58，提醒設定 00:00 → true（wrappedDiff=2）', () => {
    // 2026-07-07T15:58:00Z：台北當地為 23:58
    const nowTaipei2358 = new Date('2026-07-07T15:58:00Z');
    expect(isReminderTime(nowTaipei2358, 'Asia/Taipei', '00:00')).toBe(true);
  });

  it('時區確實生效：同一 UTC 時刻，提醒設定 20:00 在台北命中、在洛杉磯不命中', () => {
    // 同一個 nowTaipei20：台北 20:00（命中），洛杉磯（UTC-7）當地為 05:00（不命中）
    expect(isReminderTime(nowTaipei20, 'Asia/Taipei', '20:00')).toBe(true);
    expect(isReminderTime(nowTaipei20, 'America/Los_Angeles', '20:00')).toBe(false);
  });

  it('無效時區 → false（catch 分支）', () => {
    expect(isReminderTime(nowTaipei20, 'Not/AZone', '20:00')).toBe(false);
  });
});

describe('getUserToday', () => {
  it('跨日界：同一 UTC 時刻，台北與洛杉磯的「今天」相差一天', () => {
    // 2026-07-07T02:00:00Z：台北（UTC+8）為 7/7 10:00；洛杉磯（UTC-7）仍為 7/6 19:00
    const now = new Date('2026-07-07T02:00:00Z');
    expect(getUserToday(now, 'Asia/Taipei')).toBe('2026-07-07');
    expect(getUserToday(now, 'America/Los_Angeles')).toBe('2026-07-06');
  });

  it('回傳 YYYY-MM-DD 格式', () => {
    const now = new Date('2026-07-07T02:00:00Z');
    expect(getUserToday(now, 'Asia/Taipei')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('無效時區 → fallback 至台灣時區日期', () => {
    // 台北當地為 7/7 10:00，fallback 後應得台北日期
    const now = new Date('2026-07-07T02:00:00Z');
    expect(getUserToday(now, 'Not/AZone')).toBe('2026-07-07');
  });
});
