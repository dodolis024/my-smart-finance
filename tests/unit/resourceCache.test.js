import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, setCached, clearAllCaches } from '@/lib/resourceCache';

describe('resourceCache', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it('冷快取：未寫入時 getCached 回 undefined', () => {
    expect(getCached('subscriptions', 'user-A')).toBeUndefined();
  });

  it('寫入後同一 userId 可取回值', () => {
    setCached('subscriptions', 'user-A', [{ id: 1 }]);
    expect(getCached('subscriptions', 'user-A')).toEqual([{ id: 1 }]);
  });

  it('切換帳號失效：不同 userId 取同一 key 回 undefined', () => {
    setCached('subscriptions', 'user-A', [{ id: 1 }]);
    expect(getCached('subscriptions', 'user-B')).toBeUndefined();
  });

  it('登出全清：clearAllCaches 後所有 key 皆回 undefined', () => {
    setCached('subscriptions', 'user-A', [{ id: 1 }]);
    setCached('reminder_settings', 'user-A', { enabled: true });
    clearAllCaches();
    expect(getCached('subscriptions', 'user-A')).toBeUndefined();
    expect(getCached('reminder_settings', 'user-A')).toBeUndefined();
  });

  it('同 key 覆寫後取回新值', () => {
    setCached('split_groups', 'user-A', ['old']);
    setCached('split_groups', 'user-A', ['new']);
    expect(getCached('split_groups', 'user-A')).toEqual(['new']);
  });

  it('可快取有效值 null（與「未命中」的 undefined 區分）', () => {
    setCached('some_key', 'user-A', null);
    expect(getCached('some_key', 'user-A')).toBeNull();
  });

  it('userId 為 undefined 與 null 視為同一未登入身分', () => {
    setCached('k', undefined, 'v');
    expect(getCached('k', null)).toBe('v');
    expect(getCached('k', undefined)).toBe('v');
  });

  it('未登入身分寫入的快取，登入後（有 userId）不會被誤取', () => {
    setCached('k', null, 'anon-value');
    expect(getCached('k', 'user-A')).toBeUndefined();
  });

  it('不同 key 互不干擾', () => {
    setCached('a', 'user-A', 1);
    setCached('b', 'user-A', 2);
    expect(getCached('a', 'user-A')).toBe(1);
    expect(getCached('b', 'user-A')).toBe(2);
  });
});
