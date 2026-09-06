import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 期間選擇器。
 *
 * 守三件事：
 * 1. 月模式的外觀與行為要跟改動前一樣（同樣的觸發鈕標籤、12 宮格、回這個月鈕）
 * 2. 年份格狀中「沒有資料的年份」與「未來年份」都要點不動
 * 3. 全新帳號（沒有任何交易 → yearRange 為 null）不可以連今年都點不了
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 語系 mock 走真的字典：月份名稱與「年月」格式都來自 locales，斷言的才是使用者真的看到的字
const L = vi.hoisted(() => {
  const state = { lang: 'zh' };
  state.t = (key, params) => {
    const dict = state.dicts[state.lang];
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), dict);
    if (typeof val !== 'string') return val ?? key;
    return params
      ? val.replace(/\{(\w+)\}/g, (_, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`))
      : val;
  };
  return state;
});
L.dicts = { zh: (await import('@/locales/zh')).default, en: (await import('@/locales/en')).default };
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: L.t, lang: L.lang }) }));

const PeriodPicker = (await import('@/components/dashboard/PeriodPicker')).default;

const MONTH_PERIOD = { granularity: 'month', year: 2026, month: 9 };
const YEAR_PERIOD = { granularity: 'year', year: 2026 };

let container;
let root;

beforeEach(() => {
  L.lang = 'zh';
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 6, 10, 0));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const render = (props) => act(() => {
  root.render(createElement(PeriodPicker, { onChange: () => {}, ...props }));
});
const open = () => act(() => { container.querySelector('.month-picker-trigger').click(); });
const items = () => [...container.querySelectorAll('.month-picker-item')];
const tabs = () => [...container.querySelectorAll('.period-picker-tab')];

describe('PeriodPicker 月模式', () => {
  it('中文介面：觸發鈕與 12 宮格都是中文月份', () => {
    render({ period: MONTH_PERIOD, onGranularityChange: () => {} });
    expect(container.querySelector('.month-picker-trigger__label').textContent).toBe('2026年9月');

    open();
    expect(items()).toHaveLength(12);
    expect(items()[0].textContent).toBe('1月');
    expect(items()[11].textContent).toBe('12月');
    expect(items()[8].classList.contains('is-selected')).toBe(true);
  });

  it('英文介面維持 Sep 2026 與 Jan～Dec', () => {
    L.lang = 'en';
    render({ period: MONTH_PERIOD, onGranularityChange: () => {} });
    expect(container.querySelector('.month-picker-trigger__label').textContent).toBe('Sep 2026');

    open();
    expect(items()[0].textContent).toBe('Jan');
    expect(items()[11].textContent).toBe('Dec');
  });

  it('在當月時不顯示「回這個月」鈕，非當月才出現', () => {
    render({ period: MONTH_PERIOD, onGranularityChange: () => {} });
    expect(container.querySelector('.month-picker-today')).toBeNull();

    render({ period: { granularity: 'month', year: 2026, month: 4 }, onGranularityChange: () => {} });
    expect(container.querySelector('.month-picker-today')).not.toBeNull();
  });

  it('選月份回報完整的期間物件', () => {
    const onChange = vi.fn();
    render({ period: MONTH_PERIOD, onChange, onGranularityChange: () => {} });
    open();
    act(() => { items()[3].click(); });
    expect(onChange).toHaveBeenCalledWith({ granularity: 'month', year: 2026, month: 4 });
  });

  it('捲動頁面時面板立刻關閉，不等捲動停下來', () => {
    render({ period: MONTH_PERIOD, onGranularityChange: () => {} });
    open();
    expect(container.querySelector('.month-picker-popover')).not.toBeNull();

    vi.advanceTimersByTime(200); // 越過開啟瞬間的慣性忽略窗
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(container.querySelector('.month-picker-popover')).toBeNull();
  });

  it('開啟瞬間的慣性捲動不會立刻把面板關掉', () => {
    render({ period: MONTH_PERIOD, onGranularityChange: () => {} });
    open();
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(container.querySelector('.month-picker-popover')).not.toBeNull();
  });

  it('沒有傳 onGranularityChange 時不顯示粒度頁籤（自訂區間匯出的用法）', () => {
    render({ period: MONTH_PERIOD });
    open();
    expect(tabs()).toHaveLength(0);
    expect(items()).toHaveLength(12);
  });
});

describe('PeriodPicker 粒度頁籤', () => {
  it('點頁籤只回報粒度，不動錨點', () => {
    const onGranularityChange = vi.fn();
    const onChange = vi.fn();
    render({ period: MONTH_PERIOD, onChange, onGranularityChange });
    open();
    act(() => { tabs()[1].click(); });
    expect(onGranularityChange).toHaveBeenCalledWith('year');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('離線時「年」頁籤停用', () => {
    render({ period: MONTH_PERIOD, onGranularityChange: () => {}, yearDisabled: true });
    open();
    expect(tabs()[1].disabled).toBe(true);
    expect(tabs()[0].disabled).toBe(false);
  });
});

describe('PeriodPicker 年模式', () => {
  const yearOf = (label) => items().find((el) => el.textContent === label);

  it('以十年為一組顯示，翻頁一次翻一個年代', () => {
    render({ period: YEAR_PERIOD, onGranularityChange: () => {} });
    open();
    expect(items()).toHaveLength(10);
    expect(container.querySelector('.month-picker-year-display').textContent).toBe('2020 – 2029');
    expect(items()[0].textContent).toBe('2020');
    expect(items()[9].textContent).toBe('2029');

    act(() => { container.querySelectorAll('.month-picker-year-btn')[0].click(); });
    expect(container.querySelector('.month-picker-year-display').textContent).toBe('2010 – 2019');
  });

  it('資料範圍外的年份與未來年份都淡化且點不動', () => {
    const onChange = vi.fn();
    render({ period: YEAR_PERIOD, onChange, onGranularityChange: () => {}, yearRange: { minYear: 2024, maxYear: 2026 } });
    open();

    expect(yearOf('2026').disabled).toBe(false);
    expect(yearOf('2024').disabled).toBe(false);
    expect(yearOf('2023').disabled).toBe(true);
    expect(yearOf('2023').classList.contains('is-empty')).toBe(true);
    expect(yearOf('2027').disabled).toBe(true); // 未來年份

    act(() => { yearOf('2025').click(); });
    expect(onChange).toHaveBeenCalledWith({ granularity: 'year', year: 2025 });
  });

  it('全新帳號（沒有任何交易）不淡化過去年份，只擋未來', () => {
    render({ period: YEAR_PERIOD, onGranularityChange: () => {}, yearRange: null });
    open();
    expect(yearOf('2026').disabled).toBe(false);
    expect(yearOf('2020').disabled).toBe(false);
    expect(yearOf('2027').disabled).toBe(true);
    expect(yearOf('2029').classList.contains('is-empty')).toBe(true);
  });
});

describe('沒有消費的月份', () => {
  it('淡化只是提示：仍然點得下去（點空月確認自己有沒有漏記，是合理需求）', () => {
    const onChange = vi.fn();
    render({ period: MONTH_PERIOD, onChange, onGranularityChange: () => {}, monthsWithData: new Set([9, 12]) });
    open();

    expect(items()[0].classList.contains('is-no-data')).toBe(true);  // 1 月沒紀錄
    expect(items()[8].classList.contains('is-no-data')).toBe(false); // 9 月有紀錄
    expect(items()[0].disabled).toBe(false);

    act(() => { items()[0].click(); });
    expect(onChange).toHaveBeenCalledWith({ granularity: 'month', year: 2026, month: 1 });
  });

  it('還沒查到資料時不預先淡化，避免整排先灰再跳回來', () => {
    render({ period: MONTH_PERIOD, onGranularityChange: () => {} });
    open();
    expect(items().some((el) => el.classList.contains('is-no-data'))).toBe(false);
  });

  it('面板上翻年份時回報年份，讓上層去查那一年的月份', () => {
    const onDisplayYearChange = vi.fn();
    render({ period: MONTH_PERIOD, onGranularityChange: () => {}, onDisplayYearChange });
    open();
    expect(onDisplayYearChange).toHaveBeenLastCalledWith(2026);

    act(() => { container.querySelector('.month-picker-year-btn').click(); });
    expect(onDisplayYearChange).toHaveBeenLastCalledWith(2025);
  });
});
