import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 設定裡記著的交易 id（旅程的排除／手動加入、消費分析的排除清單）：
 * 交易被刪掉後要從設定拿掉；還存在的（只是不在讀取範圍內）要留著。
 * 另外鎖住旅程交易讀取失敗時的兩種錯誤：第一次就失敗、之後重抓失敗。
 */

// 假的 Supabase：transactions 與 settings 兩張表都放在記憶體
const h = vi.hoisted(() => ({
  transactions: [],
  settings: new Map(),
  upserts: [],
  idLookups: [],
  failRows: false,
  failIdLookup: false,
  reset() {
    this.transactions = [];
    this.settings = new Map();
    this.upserts = [];
    this.idLookups = [];
    this.failRows = false;
    this.failIdLookup = false;
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table) => {
    const q = { cols: '', filters: {}, inIds: null, inKeys: null, or: null, range: null, limit: null };
    const run = () => {
      if (table === 'settings') {
        if (q.inKeys) {
          const data = q.inKeys.filter((key) => h.settings.has(key)).map((key) => ({ key, value: h.settings.get(key) }));
          return { data, error: null };
        }
        const value = h.settings.get(q.filters.key);
        return { data: value === undefined ? null : { value }, error: null };
      }
      // transactions
      if (q.cols === 'id') {
        h.idLookups.push(q.inIds);
        if (h.failIdLookup) return { data: null, error: { message: 'lookup failed' } };
        return { data: h.transactions.filter((tx) => q.inIds.includes(tx.id)).map((tx) => ({ id: tx.id })), error: null };
      }
      if (q.cols === 'date') return { data: h.transactions[0] ? { date: h.transactions[0].date } : null, error: null };
      if (h.failRows) return { data: null, error: { message: 'rows failed' } };
      let rows = h.transactions;
      if (q.or) {
        // 旅程查詢：日期範圍或手動加入的 id
        const ranges = [...q.or.matchAll(/and\(date\.gte\.([\d-]+),date\.lte\.([\d-]+)\)/g)].map((m) => [m[1], m[2]]);
        const ids = (q.or.match(/id\.in\.\(([^)]*)\)/)?.[1] ?? '').split(',').filter(Boolean);
        rows = rows.filter((tx) => ids.includes(tx.id) || ranges.some(([a, b]) => tx.date >= a && tx.date <= b));
      }
      if (q.filters.type) rows = rows.filter((tx) => tx.type === q.filters.type);
      const [from, to] = q.range ?? [0, rows.length];
      return { data: rows.slice(from, to + 1), error: null };
    };
    const b = {
      select: (cols) => { q.cols = cols; return b; },
      eq: (col, value) => { q.filters[col] = value; return b; },
      gte: () => b,
      lte: () => b,
      or: (filter) => { q.or = filter; return b; },
      in: (col, values) => { if (col === 'id') q.inIds = values; else q.inKeys = values; return b; },
      order: () => b,
      limit: () => b,
      range: (from, to) => { q.range = [from, to]; return b; },
      maybeSingle: () => Promise.resolve(run()),
      upsert: (row) => {
        h.upserts.push(row);
        h.settings.set(row.key, row.value);
        return Promise.resolve({ error: null });
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  };
  return { supabase: { from: (table) => makeBuilder(table) } };
});

import { fetchDeletedTransactionIds } from '@/hooks/useTransactionSearch';
import { useTrips, TRIPS_SETTING_KEY } from '@/hooks/useTrips';
import { useSpendingAnalysis, EXCLUDED_KEY } from '@/hooks/useSpendingAnalysis';
import { clearAllCaches } from '@/lib/resourceCache';
import { getTodayYmd } from '@/lib/utils';

const tx = (id, date, extra = {}) => ({
  id,
  date,
  time: '12:00:00',
  type: 'expense',
  item_name: id,
  category: 'food',
  payment_method: null,
  currency: 'TWD',
  amount: 100,
  exchange_rate: 1,
  twd_amount: 100,
  overseas_fee_rate: null,
  overseas_fee: null,
  note: null,
  subscription_id: null,
  ...extra,
});

let container;
let root;
let api;

function TripsConsumer({ userId }) {
  api = useTrips(userId);
  return null;
}
function AnalysisConsumer({ userId, year, month }) {
  api = useSpendingAnalysis(userId, year, month);
  return null;
}

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await act(async () => { await Promise.resolve(); });
};
const mount = async (Component, props) => {
  await act(async () => { root.render(createElement(Component, props)); });
  await flush();
};

beforeEach(() => {
  h.reset();
  clearAllCaches();
  api = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('fetchDeletedTransactionIds', () => {
  it('只回傳已經不存在的 id', async () => {
    h.transactions = [tx('a', '2026-01-01'), tx('b', '2026-01-02')];
    expect(await fetchDeletedTransactionIds('u1', ['a', 'gone', 'b', 'gone2'])).toEqual(['gone', 'gone2']);
  });

  it('超過 100 個 id 會分批查', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    h.transactions = [tx('id-0', '2026-01-01'), tx('id-249', '2026-01-01')];
    const deleted = await fetchDeletedTransactionIds('u1', ids);
    expect(h.idLookups.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(deleted).toHaveLength(248);
    expect(deleted).not.toContain('id-0');
    expect(deleted).not.toContain('id-249');
  });

  it('查詢失敗就當作都還在，不回報任何 id', async () => {
    h.failIdLookup = true;
    expect(await fetchDeletedTransactionIds('u1', ['gone'])).toEqual([]);
  });

  it('沒有 id 或沒有使用者：不發查詢', async () => {
    expect(await fetchDeletedTransactionIds('u1', [])).toEqual([]);
    expect(await fetchDeletedTransactionIds('', ['a'])).toEqual([]);
    expect(h.idLookups).toEqual([]);
  });
});

describe('useTrips：清掉已刪除交易的 id', () => {
  const trip = (extra) => ({ id: 't1', name: '東京', start: '2026-03-01', end: '2026-03-05', excludedIds: [], includedIds: [], ...extra });

  it('被刪掉的交易從 includedIds／excludedIds 拿掉並存回設定', async () => {
    h.transactions = [tx('in-range', '2026-03-02'), tx('added', '2026-02-20')];
    h.settings.set(TRIPS_SETTING_KEY, {
      trips: [trip({ includedIds: ['added', 'gone-added'], excludedIds: ['in-range', 'gone-excluded'] })],
      dismissed: ['EUR:2026-01-01:2026-01-03'],
    });
    await mount(TripsConsumer, { userId: 'u1' });

    expect(api.trips[0].includedIds).toEqual(['added']);
    expect(api.trips[0].excludedIds).toEqual(['in-range']);
    const saved = h.settings.get(TRIPS_SETTING_KEY);
    expect(saved.trips[0].includedIds).toEqual(['added']);
    expect(saved.trips[0].excludedIds).toEqual(['in-range']);
    // 其他內容不動
    expect(saved.trips[0].name).toBe('東京');
    expect(saved.dismissed).toEqual(['EUR:2026-01-01:2026-01-03']);
  });

  it('交易還在、只是不在旅程日期內（改過旅程日期）：排除的 id 留著，不寫設定', async () => {
    h.transactions = [tx('outside', '2026-04-10')];
    h.settings.set(TRIPS_SETTING_KEY, { trips: [trip({ excludedIds: ['outside'] })], dismissed: [] });
    await mount(TripsConsumer, { userId: 'u1' });

    expect(api.trips[0].excludedIds).toEqual(['outside']);
    expect(h.upserts).toEqual([]);
    expect(h.idLookups).toEqual([['outside']]);
  });

  it('沒有可疑的 id：不多發查詢、不寫設定', async () => {
    h.transactions = [tx('in-range', '2026-03-02')];
    h.settings.set(TRIPS_SETTING_KEY, { trips: [trip({ excludedIds: ['in-range'] })], dismissed: [] });
    await mount(TripsConsumer, { userId: 'u1' });

    expect(h.idLookups).toEqual([]);
    expect(h.upserts).toEqual([]);
  });

  it('確認存在與否的查詢失敗：什麼都不拿掉', async () => {
    h.failIdLookup = true;
    h.settings.set(TRIPS_SETTING_KEY, { trips: [trip({ includedIds: ['gone'] })], dismissed: [] });
    await mount(TripsConsumer, { userId: 'u1' });

    expect(api.trips[0].includedIds).toEqual(['gone']);
    expect(h.upserts).toEqual([]);
  });
});

describe('useTrips：交易讀取失敗', () => {
  const setting = { trips: [{ id: 't1', name: '東京', start: '2026-03-01', end: '2026-03-05', excludedIds: [], includedIds: [] }], dismissed: [] };

  it('第一次就失敗：算載入失敗（error），不是重抓失敗', async () => {
    h.settings.set(TRIPS_SETTING_KEY, setting);
    h.failRows = true;
    await mount(TripsConsumer, { userId: 'u1' });

    expect(api.error).toEqual({ message: 'rows failed' });
    expect(api.refreshError).toBeNull();
    expect(api.loading).toBe(true);
  });

  it('載入成功過、之後重抓失敗：沿用舊的交易，只設 refreshError', async () => {
    h.transactions = [tx('in-range', '2026-03-02')];
    h.settings.set(TRIPS_SETTING_KEY, setting);
    await mount(TripsConsumer, { userId: 'u1' });
    expect(api.rows.map((r) => r.id)).toEqual(['in-range']);
    expect(api.error).toBeNull();

    h.failRows = true;
    // 改日期會重抓
    await act(async () => { await api.editTrip('t1', { name: '東京', start: '2026-03-01', end: '2026-03-06' }); });
    await flush();

    expect(api.refreshError).toEqual({ message: 'rows failed' });
    expect(api.error).toBeNull();
    expect(api.loading).toBe(false);
    expect(api.rows.map((r) => r.id)).toEqual(['in-range']);
  });
});

describe('useSpendingAnalysis：清掉已刪除交易的 id', () => {
  const today = getTodayYmd();
  const [year, month] = today.split('-').map(Number);

  it('被刪掉的交易從排除清單拿掉並存回設定；還在的留著', async () => {
    h.transactions = [
      tx('old', '2025-01-15'),
      tx('kept', today),
      // 改成收入的交易不在支出裡，但還存在
      tx('now-income', today, { type: 'income' }),
    ];
    h.settings.set(EXCLUDED_KEY, { ids: ['kept', 'gone', 'now-income'] });
    await mount(AnalysisConsumer, { userId: 'u1', year, month });

    expect(api.excludedIds).toEqual(['kept', 'now-income']);
    expect(h.settings.get(EXCLUDED_KEY)).toEqual({ ids: ['kept', 'now-income'] });
    expect(h.idLookups).toEqual([['gone', 'now-income']]);
  });

  it('清單裡的交易都在已讀的支出裡：不多發查詢、不寫設定', async () => {
    h.transactions = [tx('old', '2025-01-15'), tx('kept', today)];
    h.settings.set(EXCLUDED_KEY, { ids: ['kept'] });
    await mount(AnalysisConsumer, { userId: 'u1', year, month });

    expect(api.excludedIds).toEqual(['kept']);
    expect(h.idLookups).toEqual([]);
    expect(h.upserts).toEqual([]);
  });
});
