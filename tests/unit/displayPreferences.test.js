import { describe, it, expect, vi } from 'vitest';

// 本模組間接載入 src/lib/supabase.js，CI 沒有環境變數會直接炸，必須 mock
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { normalizeDisplayPreferences, DEFAULT_DISPLAY_PREFERENCES } = await import('@/hooks/useDisplayPreferences');

describe('normalizeDisplayPreferences', () => {
  it('沒有設定過（null／空物件）時退回預設：台幣＋顯示幣別', () => {
    expect(normalizeDisplayPreferences(null)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    expect(normalizeDisplayPreferences({})).toEqual({ currency: 'TWD', amountMode: 'converted' });
  });

  it('保留合法值，幣別統一轉大寫', () => {
    expect(normalizeDisplayPreferences({ currency: ' gbp ', amountMode: 'original' }))
      .toEqual({ currency: 'GBP', amountMode: 'original' });
  });

  it('髒值逐欄退回預設，不連坐另一欄', () => {
    expect(normalizeDisplayPreferences({ currency: 'JPY', amountMode: 'raw' }))
      .toEqual({ currency: 'JPY', amountMode: 'converted' });
    expect(normalizeDisplayPreferences({ currency: 42, amountMode: 'original' }))
      .toEqual({ currency: 'TWD', amountMode: 'original' });
    expect(normalizeDisplayPreferences({ currency: '   ' }).currency).toBe('TWD');
  });
});
