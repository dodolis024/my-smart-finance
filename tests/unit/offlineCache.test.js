import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  saveSnapshot,
  loadSnapshot,
  saveRates,
  loadRates,
  saveAccounts,
  loadAccounts,
  isOfflineError,
} from '@/lib/offlineCache';

const USER = 'user-a';

describe('offlineCache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('快照可存取往返', () => {
    saveSnapshot(USER, 2026, 7, { summary: { totalIncome: 100 } });
    const snap = loadSnapshot(USER, 2026, 7);
    expect(snap.data.summary.totalIncome).toBe(100);
    expect(typeof snap.savedAt).toBe('number');
  });

  it('沒有 userId 時不寫入、讀取回 null', () => {
    saveSnapshot(null, 2026, 7, { a: 1 });
    expect(loadSnapshot(null, 2026, 7)).toBe(null);
    expect(localStorage.length).toBe(0);
  });

  it('每位使用者只保留最近 3 份月份快照，刪最舊的', () => {
    // 依時間先後存 5 個月份(fake timer 前進確保 savedAt 遞增)
    for (const month of [1, 2, 3, 4, 5]) {
      saveSnapshot(USER, 2026, month, { month });
      vi.advanceTimersByTime(1000);
    }

    // 最舊的 1、2 月被清掉,3、4、5 月保留
    expect(loadSnapshot(USER, 2026, 1)).toBe(null);
    expect(loadSnapshot(USER, 2026, 2)).toBe(null);
    expect(loadSnapshot(USER, 2026, 3)?.data.month).toBe(3);
    expect(loadSnapshot(USER, 2026, 4)?.data.month).toBe(4);
    expect(loadSnapshot(USER, 2026, 5)?.data.month).toBe(5);
  });

  it('重存既有月份會更新其新舊順位(LRU 行為)', () => {
    for (const month of [1, 2, 3]) {
      saveSnapshot(USER, 2026, month, { month });
      vi.advanceTimersByTime(1000);
    }
    // 重存 1 月 → 1 月變最新
    saveSnapshot(USER, 2026, 1, { month: 1, updated: true });
    vi.advanceTimersByTime(1000);
    // 存第 4 個月份 → 應淘汰目前最舊的 2 月
    saveSnapshot(USER, 2026, 4, { month: 4 });

    expect(loadSnapshot(USER, 2026, 2)).toBe(null);
    expect(loadSnapshot(USER, 2026, 1)?.data.updated).toBe(true);
    expect(loadSnapshot(USER, 2026, 3)?.data.month).toBe(3);
    expect(loadSnapshot(USER, 2026, 4)?.data.month).toBe(4);
  });

  it('清理只影響同一位使用者的快照', () => {
    saveSnapshot('user-b', 2026, 1, { keep: true });
    vi.advanceTimersByTime(1000);
    for (const month of [1, 2, 3, 4]) {
      saveSnapshot(USER, 2026, month, { month });
      vi.advanceTimersByTime(1000);
    }
    expect(loadSnapshot('user-b', 2026, 1)?.data.keep).toBe(true);
    expect(loadSnapshot(USER, 2026, 1)).toBe(null); // user-a 超量,最舊被清
  });

  it('匯率與帳戶快取往返', () => {
    saveRates({ USD: 31.5, TWD: 1 });
    expect(loadRates()).toEqual({ USD: 31.5, TWD: 1 });

    saveAccounts(USER, [{ id: 'acc1', accountName: '現金' }]);
    expect(loadAccounts(USER)).toEqual([{ id: 'acc1', accountName: '現金' }]);
    expect(loadAccounts('other-user')).toEqual([]);
  });

  it('isOfflineError 辨識瀏覽器斷網訊息', () => {
    expect(isOfflineError(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isOfflineError(new Error('Load failed'))).toBe(true);
    expect(isOfflineError(new Error('duplicate key value'))).toBe(false);
    expect(isOfflineError(null)).toBe(false);
  });
});
