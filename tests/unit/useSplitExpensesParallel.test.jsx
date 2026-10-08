import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 分帳的往返並行化。
 * 守兩件事：不相依的請求確實同時發出（不是一個等一個），
 * 以及 addExpense 回傳時所有請求都已完成——沒有任何事被丟到背景。
 */

const h = vi.hoisted(() => ({
  pending: [], // { label, resolve }：尚未回應的請求，依發出順序
  log: [], // 'start:<label>' / 'end:<label>'
  responses: {},
}));

function request(label) {
  h.log.push(`start:${label}`);
  return new Promise((resolve) => {
    h.pending.push({
      label,
      resolve: () => {
        h.log.push(`end:${label}`);
        resolve(h.responses[label] ?? { data: [], error: null });
      },
    });
  });
}

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table) => {
    let op = 'select';
    let p = null;
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      upsert: () => { op = 'upsert'; return b; },
      then: (res, rej) => {
        p ??= request(`${op}:${table}`);
        return p.then(res, rej);
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => makeBuilder(table),
      rpc: (fn) => request(`rpc:${fn}`),
    },
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/lib/splitNotify', () => ({ notifySplit: vi.fn() }));

const { useSplitExpenses } = await import('@/hooks/useSplitExpenses');
const { clearAllCaches } = await import('@/lib/resourceCache');
const { getTodayYmd } = await import('@/lib/utils');

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

/** 呼叫 hook 方法；先掛上 catch，免得還沒 await 前的拒絕被當成未處理 */
function start(fn) {
  const p = fn();
  p.catch(() => {});
  return p;
}

/** 回應目前所有已發出的請求，並等到它們引發的後續請求也發出 */
async function respondAll() {
  const batch = h.pending.splice(0);
  batch.forEach((x) => x.resolve());
  await flush();
  return batch.map((x) => x.label);
}

let result;
let root;
let container;

function mount(actorUserId = 'user-1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    result = useSplitExpenses('group-1', { actorName: 'A', actorUserId, groupName: 'G' });
    return null;
  }
  act(() => root.render(createElement(Harness)));
}

const expenseInput = (over = {}) => ({
  title: '晚餐',
  amount: 300,
  currency: 'TWD',
  date: getTodayYmd(),
  note: '',
  paidBy: 'm1',
  shares: [{ member_id: 'm1', share: 300 }],
  ...over,
});

beforeEach(() => {
  h.pending.length = 0;
  h.log.length = 0;
  h.responses = {};
  clearAllCaches();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('打開群組', () => {
  it('費用與還款紀錄同時發出', async () => {
    mount();
    let done = false;
    const p = start(() => result.fetchExpenses()).then(() => { done = true; });
    await flush();

    expect(h.pending.map((x) => x.label).sort()).toEqual(['select:split_expenses', 'select:split_settlements']);
    await respondAll();
    await act(async () => { await p; });
    expect(done).toBe(true);
  });

  it('還款紀錄讀取失敗仍載入費用', async () => {
    h.responses['select:split_expenses'] = { data: [{ id: 'e1' }], error: null };
    h.responses['select:split_settlements'] = { data: null, error: { message: 'boom' } };
    mount();
    const p = start(() => result.fetchExpenses());
    await flush();
    await respondAll();
    await act(async () => { await p; });
    expect(result.expenses).toEqual([{ id: 'e1' }]);
    expect(result.settlements).toEqual([]);
  });

  it('費用讀取失敗照樣拋錯', async () => {
    h.responses['select:split_expenses'] = { data: null, error: { message: 'denied' } };
    mount();
    const p = start(() => result.fetchExpenses());
    await flush();
    await respondAll();
    await expect(act(async () => { await p; })).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('新增今天的費用', () => {
  it('重抓清單與簽到同時開始，對帳在簽到之後', async () => {
    mount();
    let done = false;
    const p = start(() => result.addExpense(expenseInput())).then(() => { done = true; });
    await flush();

    expect(await respondAll()).toEqual(['rpc:add_split_expense']);
    // 第二輪：清單兩個查詢＋簽到一起出發
    expect(await respondAll()).toEqual(
      expect.arrayContaining(['select:split_expenses', 'select:split_settlements', 'upsert:checkins'])
    );
    expect(done).toBe(false);
    // 第三輪：對帳
    expect(await respondAll()).toEqual(['rpc:reconcile_streak_freezes']);
    await act(async () => { await p; });
    expect(done).toBe(true);
  });

  it('對帳還沒回來前不會結束', async () => {
    mount();
    let done = false;
    const p = start(() => result.addExpense(expenseInput())).then(() => { done = true; });
    await flush();
    await respondAll(); // add_split_expense
    await respondAll(); // 清單＋簽到
    await flush();
    expect(h.pending.map((x) => x.label)).toEqual(['rpc:reconcile_streak_freezes']);
    expect(done).toBe(false);
    await respondAll();
    await act(async () => { await p; });
    expect(done).toBe(true);
  });

  it('簽到失敗就不對帳，也不讓新增看起來失敗', async () => {
    h.responses['upsert:checkins'] = { error: { message: 'checkin failed' } };
    mount();
    const p = start(() => result.addExpense(expenseInput()));
    await flush();
    await respondAll();
    await respondAll();
    await act(async () => { await p; });
    expect(h.log).not.toContain('start:rpc:reconcile_streak_freezes');
  });
});

describe('不需要簽到的費用', () => {
  it('不是今天的費用只重抓清單', async () => {
    mount();
    const p = start(() => result.addExpense(expenseInput({ date: '2020-01-01' })));
    await flush();
    await respondAll();
    expect(await respondAll()).toEqual(
      expect.arrayContaining(['select:split_expenses', 'select:split_settlements'])
    );
    await act(async () => { await p; });
    expect(h.log.some((l) => l.includes('checkins'))).toBe(false);
  });

  it('未連結成員不簽到', async () => {
    mount('');
    const p = start(() => result.addExpense(expenseInput()));
    await flush();
    await respondAll();
    await respondAll();
    await act(async () => { await p; });
    expect(h.log.some((l) => l.includes('checkins'))).toBe(false);
  });
});
