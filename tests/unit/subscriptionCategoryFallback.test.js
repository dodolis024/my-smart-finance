import { describe, it, expect } from 'vitest';
import { otherCategoryLabel } from '../../supabase/functions/_shared/categoryLabels.ts';
import zh from '../../src/locales/zh.js';
import en from '../../src/locales/en.js';

/**
 * 訂閱未填分類時，排程（process-subscriptions）與前端（useSubscriptions 的
 * t('transaction.other')）要落在同一個分類名稱，否則同一個訂閱會依「誰建立那筆交易」
 * 分別記進「其他」與「Other」兩個分類。這裡直接拿 locales 當基準對照。
 */
describe('otherCategoryLabel', () => {
  it('與前端 transaction.other 文案一致', () => {
    expect(otherCategoryLabel('zh')).toBe(zh.transaction.other);
    expect(otherCategoryLabel('en')).toBe(en.transaction.other);
  });

  it('未知語言退回中文（與 normalizeLang 的 fallback 一致）', () => {
    expect(otherCategoryLabel('fr')).toBe(zh.transaction.other);
    expect(otherCategoryLabel(undefined)).toBe(zh.transaction.other);
  });
});
