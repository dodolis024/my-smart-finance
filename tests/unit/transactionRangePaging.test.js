import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模擬正式站的行為：不管要幾筆，單次最多回 SERVER_MAX_ROWS 列（2026-11-12 實測為 1000）
const SERVER_MAX_ROWS = 1000;

const h = vi.hoisted(() => ({
  table: [],
  ranges: [],
  countRequests: 0,
  failAtFrom: null,
  reset() {
    this.table = [];
    this.ranges = [];
    this.countRequests = 0;
    this.failAtFrom = null;
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = () => {
    let wantCount = false;
    const b = {
      select: (_columns, options) => {
        wantCount = options?.count === 'exact';
        return b;
      },
      eq: () => b,
      gte: () => b,
      lte: () => b,
      order: () => b,
      range: (from, to) => {
        h.ranges.push([from, to]);
        if (wantCount) h.countRequests += 1;
        if (h.failAtFrom === from) return Promise.resolve({ data: null, count: null, error: { message: 'boom' } });
        const data = h.table.slice(from, Math.min(to + 1, from + SERVER_MAX_ROWS));
        return Promise.resolve({ data, count: wantCount ? h.table.length : null, error: null });
      },
    };
    return b;
  };
  return { supabase: { from: () => makeBuilder() } };
});

import { fetchTransactionsByDateRange, fetchAllPages, RANGE_PAGE_SIZE } from '@/hooks/useTransactionSearch';

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: `tx-${String(i).padStart(5, '0')}`,
  date: '2026-01-01',
  time: '12:00:00',
  type: 'expense',
  item_name: `item ${i}`,
  category: 'food',
  payment_method: null,
  currency: 'TWD',
  amount: 1,
  exchange_rate: 1,
  twd_amount: 1,
  overseas_fee_rate: null,
  overseas_fee: null,
  note: null,
}));

describe('fetchTransactionsByDateRange 分批讀取', () => {
  beforeEach(() => h.reset());

  it('匯出（不限筆數）：超過伺服器單次上限也全部讀回來，順序不變、不重複', async () => {
    h.table = makeRows(2500);
    const { rows, count, error } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31');
    expect(error).toBeNull();
    expect(rows).toHaveLength(2500);
    expect(count).toBe(2500);
    expect(rows.map((r) => r.id)).toEqual(h.table.map((r) => r.id));
    expect(h.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('最新的那幾筆不會被截掉（修正前只拿得到前 1000 筆）', async () => {
    h.table = makeRows(1371);
    const { rows } = await fetchTransactionsByDateRange('u1', '2025-01-01', '2026-12-31');
    expect(rows).toHaveLength(1371);
    expect(rows[rows.length - 1].id).toBe('tx-01370');
  });

  it('筆數剛好是一批的整數倍：多問一批拿到空的就停', async () => {
    h.table = makeRows(RANGE_PAGE_SIZE);
    const { rows } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31');
    expect(rows).toHaveLength(RANGE_PAGE_SIZE);
    expect(h.ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('不到一批：只查一次', async () => {
    h.table = makeRows(3);
    const { rows, count } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31');
    expect(rows).toHaveLength(3);
    expect(count).toBe(3);
    expect(h.ranges).toEqual([[0, 999]]);
  });

  it('年檢視（limit 5000、要總數）：1371 筆全部載入，總數等於載入筆數，不會誤報「只載入一部分」', async () => {
    h.table = makeRows(1371);
    const { rows, count } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31', { limit: 5000, count: true });
    expect(rows).toHaveLength(1371);
    expect(count).toBe(1371);
    // 總數只在第一批問一次
    expect(h.countRequests).toBe(1);
  });

  it('年檢視超過 limit：只載入 limit 筆，總數仍是實際筆數（畫面據此提示）', async () => {
    h.table = makeRows(5200);
    const { rows, count } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31', { limit: 5000, count: true });
    expect(rows).toHaveLength(5000);
    expect(count).toBe(5200);
    expect(h.ranges[h.ranges.length - 1]).toEqual([4000, 4999]);
  });

  it('limit 不是一批的整數倍：最後一批只要剩下的筆數', async () => {
    h.table = makeRows(3000);
    const { rows } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31', { limit: 1500 });
    expect(rows).toHaveLength(1500);
    expect(h.ranges).toEqual([[0, 999], [1000, 1499]]);
  });

  it('中途某一批失敗：整個算失敗，不回傳只有一部分的資料', async () => {
    h.table = makeRows(2500);
    h.failAtFrom = 1000;
    const { rows, error } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31');
    expect(error).toEqual({ message: 'boom' });
    expect(rows).toEqual([]);
  });

  it('沒有交易：回空陣列、不報錯', async () => {
    const { rows, count, error } = await fetchTransactionsByDateRange('u1', '2026-01-01', '2026-12-31');
    expect(rows).toEqual([]);
    expect(count).toBe(0);
    expect(error).toBeNull();
  });

  it('缺參數：不發查詢', async () => {
    const { rows } = await fetchTransactionsByDateRange('', '2026-01-01', '2026-12-31');
    expect(rows).toEqual([]);
    expect(h.ranges).toEqual([]);
  });
});

describe('fetchAllPages', () => {
  it('data 是 null（查詢回來沒有資料）就停，不會無限迴圈', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ data: null, error: null });
    const { rows, error } = await fetchAllPages(fetchPage);
    expect(rows).toEqual([]);
    expect(error).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
