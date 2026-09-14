import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatOriginalMoney } from '@/lib/utils';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Provider 內部會讀使用者的顯示偏好；這裡直接替換成可控的值，不碰 Supabase
const prefs = vi.hoisted(() => ({ current: { currency: 'TWD', amountMode: 'converted' } }));
vi.mock('@/hooks/useDisplayPreferences', () => ({
  DEFAULT_DISPLAY_PREFERENCES: { currency: 'TWD', amountMode: 'converted' },
  useDisplayPreferences: () => ({
    displayPreferences: prefs.current,
    loadDisplayPreferences: () => Promise.resolve(),
  }),
}));

// 匯率表由各換算測試自行提供；這裡只測原幣／台幣路徑，不需要真的去抓匯率
vi.mock('@/hooks/useDisplayRates', () => ({ useDisplayRates: () => null }));
// 保險：任何間接載入 src/lib/supabase.js 的路徑在 CI（沒有環境變數）都會直接炸
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { DisplayAmountProvider, useDisplayAmount } = await import('@/contexts/DisplayAmountContext');

let cleanup = null;
afterEach(() => { cleanup?.(); cleanup = null; });

/** 在 Provider 內（或外）取得 useDisplayAmount 的回傳值 */
function readDisplayAmount({ withProvider }) {
  const container = document.createElement('div');
  const root = createRoot(container);
  const result = { current: null };
  function Harness() {
    result.current = useDisplayAmount();
    return null;
  }
  act(() => {
    root.render(withProvider ? createElement(DisplayAmountProvider, null, createElement(Harness)) : createElement(Harness));
  });
  cleanup = () => act(() => root.unmount());
  return result.current;
}

const gbpTx = { currency: 'GBP', originalAmount: 12.5, twdAmount: 527.34 };
const twdTx = { currency: 'TWD', originalAmount: 1234, twdAmount: 1234 };

describe('formatOriginalMoney', () => {
  it('有小數的幣別固定兩位，零小數幣別（含台幣）取整', () => {
    expect(formatOriginalMoney(12.5, 'GBP')).toBe('£12.50');
    expect(formatOriginalMoney(1234.56, 'usd')).toBe('US$1,234.56');
    expect(formatOriginalMoney(1200.4, 'JPY')).toBe('¥1,200');
    expect(formatOriginalMoney(1234, 'TWD')).toBe('$1,234');
  });

  it('沒帶幣別當台幣；字串金額也吃', () => {
    expect(formatOriginalMoney('88', null)).toBe('$88');
  });

  it('不合法的幣別代碼不會炸，退回「代碼 金額」', () => {
    expect(formatOriginalMoney(10, 'ABCD')).toBe('ABCD 10.00');
  });
});

describe('useDisplayAmount', () => {
  it('Provider 以外：一律照舊顯示台幣（手機版取整）', () => {
    const { amountMode, formatTxAmount } = readDisplayAmount({ withProvider: false });
    expect(amountMode).toBe('converted');
    expect(formatTxAmount(gbpTx)).toBe('$527');
    expect(formatTxAmount(gbpTx, { isMobile: true })).toBe('$527');
  });

  it('原幣模式：顯示記帳時輸入的幣別與金額，不含手續費換算', () => {
    prefs.current = { currency: 'TWD', amountMode: 'original' };
    const { formatTxAmount } = readDisplayAmount({ withProvider: true });
    expect(formatTxAmount(gbpTx)).toBe('£12.50');
    expect(formatTxAmount(gbpTx, { isMobile: true })).toBe('£12.50');
    expect(formatTxAmount(twdTx)).toBe('$1,234');
  });

  it('原幣模式：離線佇列的列只有 amount 欄位也要讀得到', () => {
    prefs.current = { currency: 'TWD', amountMode: 'original' };
    const { formatTxAmount } = readDisplayAmount({ withProvider: true });
    expect(formatTxAmount({ currency: 'USD', amount: 8, twdAmount: 256 })).toBe('US$8.00');
  });

  it('顯示幣別模式（台幣）：行為與加入功能前相同', () => {
    prefs.current = { currency: 'TWD', amountMode: 'converted' };
    const { formatTxAmount } = readDisplayAmount({ withProvider: true });
    expect(formatTxAmount(gbpTx)).toBe('$527');
  });
});
