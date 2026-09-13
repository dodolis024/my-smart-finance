import { describe, it, expect } from 'vitest';
import { buildQueuedRows, mergeQueuedIntoHistory, mergeQueuedIntoSummary } from '@/lib/offlineMerge';

const makeItem = (over = {}) => ({
  id: over.id ?? 'q1',
  status: over.status ?? 'pending',
  errorMessage: over.errorMessage,
  tx: {
    id: over.id ?? 'q1',
    date: '2026-07-08',
    type: 'expense',
    category: '飲食',
    item_name: '午餐',
    payment_method: '現金',
    currency: 'TWD',
    amount: 120,
    twd_amount: 120,
    note: null,
    ...over.tx,
  },
});

describe('buildQueuedRows', () => {
  it('空佇列回傳空陣列', () => {
    expect(buildQueuedRows([], '2026-07-01', '2026-07-31')).toEqual([]);
  });

  it('只保留區間內的項目（含頭尾端點）', () => {
    const items = [
      makeItem({ id: 'a', tx: { date: '2026-07-31' } }),
      makeItem({ id: 'b', tx: { date: '2026-06-30' } }),
      makeItem({ id: 'c', tx: { date: '2025-07-08' } }),
    ];
    const rows = buildQueuedRows(items, '2026-07-01', '2026-07-31');
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('跨月區間（年檢視）撈得到整年的佇列項目', () => {
    const items = [
      makeItem({ id: 'a', tx: { date: '2026-01-01' } }),
      makeItem({ id: 'b', tx: { date: '2026-06-30' } }),
      makeItem({ id: 'c', tx: { date: '2026-09-06' } }),
      makeItem({ id: 'd', tx: { date: '2026-09-07' } }),   // 超過迄日（年模式以今天為上限）
      makeItem({ id: 'e', tx: { date: '2025-12-31' } }),   // 前一年
    ];
    const rows = buildQueuedRows(items, '2026-01-01', '2026-09-06');
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('欄位映射成駝峰列格式並標記 pending 與佇列狀態', () => {
    const [row] = buildQueuedRows(
      [makeItem({ status: 'failed', errorMessage: '網路逾時' })],
      '2026-07-01',
      '2026-07-31'
    );
    expect(row).toEqual({
      id: 'q1',
      date: '2026-07-08',
      type: 'expense',
      category: '飲食',
      itemName: '午餐',
      paymentMethod: '現金',
      currency: 'TWD',
      amount: 120,
      twdAmount: 120,
      overseasFeeRate: null,
      overseasFee: null,
      note: null,
      pending: true,
      queueStatus: 'failed',
      queueError: '網路逾時',
    });
  });

  it('海外消費的佇列項目帶出手續費欄位（詳細頁要拆本體與手續費）', () => {
    const [row] = buildQueuedRows(
      [makeItem({ tx: { currency: 'GBP', amount: 10, twd_amount: 426.66, overseas_fee_rate: 1.5, overseas_fee: 6.31 } })],
      '2026-07-01',
      '2026-07-31'
    );
    expect(row.overseasFeeRate).toBe(1.5);
    expect(row.overseasFee).toBe(6.31);
    expect(row.twdAmount).toBe(426.66);
  });

  it('tx 缺 date 時不進列表也不崩潰', () => {
    expect(buildQueuedRows([{ id: 'x', status: 'pending', tx: {} }], '2026-07-01', '2026-07-31')).toEqual([]);
  });
});

describe('mergeQueuedIntoHistory', () => {
  it('無佇列列時回傳原列表（同一參考，不重排）', () => {
    const history = [{ id: 't1', date: '2026-07-01' }];
    expect(mergeQueuedIntoHistory(history, [])).toBe(history);
  });

  it('合併後依日期新→舊排序', () => {
    const history = [
      { id: 't1', date: '2026-07-06' },
      { id: 't2', date: '2026-07-02' },
    ];
    const queued = [{ id: 'q1', date: '2026-07-04' }];
    expect(mergeQueuedIntoHistory(history, queued).map((r) => r.id)).toEqual(['t1', 'q1', 't2']);
  });
});

describe('mergeQueuedIntoSummary', () => {
  const summary = { totalIncome: 1000, totalExpense: 400, balance: 600 };

  it('無佇列列時回傳原彙總（同一參考）', () => {
    expect(mergeQueuedIntoSummary(summary, [])).toBe(summary);
  });

  it('支出與收入分別併入,結餘同步更新', () => {
    const queued = [
      { type: 'expense', twdAmount: 120 },
      { type: 'income', twdAmount: 500 },
    ];
    expect(mergeQueuedIntoSummary(summary, queued)).toEqual({
      totalIncome: 1500,
      totalExpense: 520,
      balance: 980,
    });
  });

  it('twdAmount 非數字時以 0 計,不產生 NaN', () => {
    const queued = [{ type: 'expense', twdAmount: undefined }];
    expect(mergeQueuedIntoSummary(summary, queued)).toEqual(summary);
  });
});
