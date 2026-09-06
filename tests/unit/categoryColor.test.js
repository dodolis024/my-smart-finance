import { describe, it, expect } from 'vitest';
import { buildCategoryColorMap, getChartPalette } from '@/lib/categoryColor';

const PALETTE = ['c0', 'c1', 'c2'];

const tx = (category, twdAmount) => ({ category, twdAmount });

describe('分類顏色對應', () => {
  it('依支出金額由大到小配色（與圓餅圖的切片順序一致）', () => {
    const map = buildCategoryColorMap(
      [tx('餐飲', 100), tx('購物', 500), tx('交通', 50), tx('餐飲', 100)],
      [],
      PALETTE,
      '未分類'
    );

    // 購物 500 > 餐飲 200 > 交通 50
    expect(map.get('購物')).toBe('c0');
    expect(map.get('餐飲')).toBe('c1');
    expect(map.get('交通')).toBe('c2');
  });

  it('收入分類不進圓餅圖，也就沒有顏色', () => {
    const map = buildCategoryColorMap([tx('薪資', 52000), tx('餐飲', 100)], ['薪資'], PALETTE, '未分類');

    expect(map.has('薪資')).toBe(false);
    expect(map.get('餐飲')).toBe('c0');
  });

  it('分類數超過色盤時循環取用', () => {
    const map = buildCategoryColorMap(
      [tx('a', 5), tx('b', 4), tx('c', 3), tx('d', 2)],
      [],
      PALETTE,
      '未分類'
    );

    expect(map.get('d')).toBe('c0');
  });

  it('空白分類歸到未分類這個名字底下', () => {
    const map = buildCategoryColorMap([tx('  ', 10), tx(null, 10)], [], PALETTE, '未分類');

    expect(map.get('未分類')).toBe('c0');
    expect(map.size).toBe(1);
  });

  it('每套主題各有色盤，未知主題退回預設', () => {
    expect(getChartPalette('rose')).not.toEqual(getChartPalette('soda'));
    expect(getChartPalette('不存在的主題')).toEqual(getChartPalette(undefined));
  });
});
