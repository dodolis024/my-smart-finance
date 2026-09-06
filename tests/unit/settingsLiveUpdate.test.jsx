import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 設定面板的編輯要「即時反映」，使用者不需要重整。
 *
 * 設定面板與儀表板是同時掛載的兩棵子樹，靠兩條管道同步：
 *   1. resourceCache 的 'settings' 訂閱 → 類別下拉即時換掉
 *   2. notifyDataChanged() → 儀表板靜默重抓（帳戶、以及被改名連帶改寫的舊交易）
 * 這支測試把兩邊一起掛起來，實際做每一種編輯，驗畫面上的資料真的跟著變。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pad = (n) => String(n).padStart(2, '0');
const TODAY = new Date();
const Y = TODAY.getFullYear();
const M = TODAY.getMonth() + 1;
const D = TODAY.getDate();

/* ---------------- 假後端：認得設定、帳戶、交易的最小可用資料庫 ---------------- */
const db = vi.hoisted(() => ({
  settings: {},
  accounts: [],
  transactions: [],
  reset() {
    this.settings = {
      expense_categories: ['飲食', '交通', '購物'],
      income_categories: ['薪水'],
      default_currency: 'TWD',
    };
    this.accounts = [
      { id: 'a1', user_id: 'u1', name: '現金', type: 'cash' },
      { id: 'a2', user_id: 'u1', name: 'Cube', type: 'credit_card', credit_limit: 50000 },
    ];
    this.transactions = [
      { id: 't1', user_id: 'u1', date: '', time: '10:00:00', type: 'expense', item_name: '午餐', category: '飲食', payment_method: '現金', currency: 'TWD', amount: 100, exchange_rate: 1, twd_amount: 100, note: null },
      { id: 't2', user_id: 'u1', date: '', time: '11:00:00', type: 'expense', item_name: '捷運', category: '交通', payment_method: 'Cube', currency: 'TWD', amount: 30, exchange_rate: 1, twd_amount: 30, note: null },
    ];
  },
}));

vi.mock('@/lib/supabase', () => {
  const camel = (r) => ({
    id: r.id, date: r.date, time: r.time, type: r.type, category: r.category,
    itemName: r.item_name, paymentMethod: r.payment_method, currency: r.currency,
    originalAmount: r.amount, exchangeRate: r.exchange_rate, twdAmount: r.twd_amount, note: r.note,
  });
  return {
    supabase: {
      rpc: async (name) => {
        if (name === 'get_dashboard_data') {
          const rows = db.transactions;
          const totalExpense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.twd_amount, 0);
          return {
            data: {
              success: true,
              summary: { totalIncome: 0, totalExpense, balance: -totalExpense },
              history: rows.map(camel),
              // 儀表板的帳戶來自 RPC（駝峰），不吃 'settings' 快取
              accounts: db.accounts.map((a) => ({
                id: a.id, accountName: a.name, type: a.type, creditLimit: a.credit_limit,
              })),
              categoriesExpense: [...db.settings.expense_categories],
              categoriesIncome: [...db.settings.income_categories],
              currentStreak: 1,
              streakBroken: false,
            },
            error: null,
          };
        }
        if (name === 'get_available_currencies') return { data: ['TWD', 'JPY', 'GBP'], error: null };
        if (name === 'reconcile_streak_freezes') return { data: { consumedThisCall: 0 }, error: null };
        return { data: null, error: null };
      },
      from: (table) => {
        const q = { eqs: {}, head: false };
        const b = {
          select: (_c, opts) => { q.head = !!opts?.head; return b; },
          eq: (col, val) => { q.eqs[col] = val; return b; },
          gte: (_c, v) => { q.gte = v; return b; },
          lte: (_c, v) => { q.lte = v; return b; },
          order: () => b,
          limit: () => b,
          // useTransactionMonthsInYear 以 range() 分頁掃一整年的日期
          range: (from, to) => { q.range = [from, to]; return b; },
          single: async () => run(),
          maybeSingle: async () => run(),
          upsert: async (payload) => {
            if (table === 'settings') db.settings[payload.key] = payload.value;
            return { error: null };
          },
          insert: async (payload) => {
            if (table === 'accounts') db.accounts.push({ ...payload, id: `a${db.accounts.length + 1}` });
            if (table === 'transactions') db.transactions.push({ ...payload, id: `t${db.transactions.length + 1}` });
            return { error: null };
          },
          update: (payload) => ({
            eq: (col, val) => {
              const chain = {
                eq: (col2, val2) => {
                  if (table === 'transactions') {
                    db.transactions.forEach((t) => {
                      if (t[col] === val && t[col2] === val2) Object.assign(t, payload);
                    });
                  }
                  return Promise.resolve({ error: null });
                },
                then: (resolve) => {
                  if (table === 'accounts') {
                    const a = db.accounts.find((x) => x[col] === val);
                    if (a) Object.assign(a, payload);
                  }
                  return resolve({ error: null });
                },
              };
              return chain;
            },
          }),
          delete: () => ({
            eq: async (col, val) => {
              if (table === 'accounts') db.accounts = db.accounts.filter((a) => a[col] !== val);
              return { error: null };
            },
          }),
          then: (resolve) => resolve(run()),
        };
        const run = () => {
          if (table === 'settings') return { data: { value: db.settings[q.eqs.key] }, error: null };
          if (table === 'accounts') return { data: db.accounts.map((a) => ({ ...a })), error: null };
          if (table === 'transactions') {
            let rows = db.transactions.filter((t) => Object.entries(q.eqs).every(([k, v]) => t[k] === v));
            if (q.gte) rows = rows.filter((t) => t.date >= q.gte);
            if (q.lte) rows = rows.filter((t) => t.date <= q.lte);
            if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
            return q.head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null };
          }
          return { data: [], count: 0, error: null };
        };
        return b;
      },
    },
  };
});

const LANG = { lang: 'zh', t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k) };
const TOAST = { success: () => {}, error: () => {}, info: () => {} };
const CONFIRM = { confirm: async () => true };
const AUTH = { user: { id: 'u1', email: 'x@y.z' }, ensureDefaultDataForOAuth: async () => {} };
const THEME = { theme: 'rose', setTheme: () => {} };
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => LANG }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => TOAST }));
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => CONFIRM }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => AUTH }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => THEME, THEMES: ['default', 'rose'] }));
vi.mock('@/components/layout/TopBar', () => ({ default: () => <div /> }));
vi.mock('@/components/dashboard/YearlyReviewBanner', () => ({ default: () => <div /> }));
// 圓餅圖在 jsdom 沒有 canvas；用探針印出它實際吃到的分類，效果等同
vi.mock('@/components/dashboard/CategoryChart', () => ({
  default: ({ history = [] }) => (
    <div className="chart-probe" data-cats={[...new Set(history.map((h) => h.category))].join(',')} />
  ),
}));
// 記帳表單只需要驗它拿到的下拉來源，不必渲染整張表單
vi.mock('@/components/transactions/TransactionForm', () => ({
  default: ({ categoriesExpense = [], categoriesIncome = [], accounts = [], defaultCurrency }) => (
    <div
      className="form-probe"
      data-expense={categoriesExpense.join(',')}
      data-income={categoriesIncome.join(',')}
      data-accounts={accounts.map((a) => a.accountName || a.name).join(',')}
      data-currency={defaultCurrency}
    />
  ),
}));

const DashboardPage = (await import('@/pages/DashboardPage')).default;
const { useSettings } = await import('@/hooks/useSettings');
const { useDashboard } = await import('@/hooks/useDashboard');

/** 設定面板的替身：呼叫的是真的 useSettings / useDashboard，與真實面板同一條路徑 */
let actions = {};
function SettingsProbe() {
  const s = useSettings();
  const { saveDefaultCurrency } = useDashboard();
  const { loadSettingsData } = s;
  useEffect(() => { loadSettingsData(); }, [loadSettingsData]);
  actions = { ...s, saveDefaultCurrency };
  return <i className="settings-probe" data-accounts={s.accounts.map((a) => a.name).join(',')} />;
}

let container, root;
beforeEach(() => {
  db.reset();
  const ymd = `${Y}-${pad(M)}-${pad(D)}`;
  db.transactions.forEach((t) => { t.date = ymd; });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  actions = {};
});

const $ = (s) => container.querySelector(s);
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async () => {
  await act(async () => {
    root.render(<><DashboardPage /><SettingsProbe /></>);
  });
  await settle();
};
const run = async (fn) => { await act(async () => { await fn(); }); await settle(); };

const formProbe = () => $('.form-probe').dataset;
const chartCats = () => $('.chart-probe').dataset.cats.split(',').filter(Boolean);
const paymentNames = () => [...container.querySelectorAll('.payment-stats-list .pay-name')].map((e) => e.textContent);
const tableCategories = () => [...container.querySelectorAll('tbody tr[data-id] .cell-category, tbody tr[data-id] td:nth-child(2)')]
  .map((e) => e.textContent.trim());

describe('設定改動要即時反映到主畫面（不需重整）', () => {
  it('新增消費分類 → 記帳表單的分類下拉立刻多一項', async () => {
    await mount();
    expect(formProbe().expense.split(',')).toEqual(['飲食', '交通', '購物']);

    await run(() => actions.addCategory('expense', '寵物'));
    expect(formProbe().expense.split(',')).toEqual(['飲食', '交通', '購物', '寵物']);
  });

  it('刪除消費分類 → 下拉立刻少一項', async () => {
    await mount();
    await run(() => actions.deleteCategory('expense', '購物'));
    expect(formProbe().expense.split(',')).toEqual(['飲食', '交通']);
  });

  it('拖曳排序分類 → 下拉順序立刻跟著換', async () => {
    await mount();
    await run(() => actions.reorderCategoriesTo('expense', ['購物', '飲食', '交通']));
    expect(formProbe().expense.split(',')).toEqual(['購物', '飲食', '交通']);
  });

  it('新增收入分類 → 收入下拉立刻多一項', async () => {
    await mount();
    await run(() => actions.addCategory('income', '獎金'));
    expect(formProbe().income.split(',')).toEqual(['薪水', '獎金']);
  });

  it('分類改名 → 下拉、圓餅圖、明細表的舊名稱同時換掉', async () => {
    await mount();
    expect(chartCats()).toContain('飲食');

    await run(() => actions.renameCategory('expense', '飲食', '吃飯'));

    expect(formProbe().expense.split(',')).toContain('吃飯');
    expect(formProbe().expense.split(',')).not.toContain('飲食');
    // 舊交易被改寫後儀表板要重抓，圖表與表格不能還停在舊名稱
    expect(chartCats()).toContain('吃飯');
    expect(chartCats()).not.toContain('飲食');
    expect(tableCategories().join(',')).toContain('吃飯');
  });

  it('新增支付方式 → 記帳表單的付款下拉立刻多一項', async () => {
    await mount();
    expect(formProbe().accounts.split(',')).toEqual(['現金', 'Cube']);

    await run(() => actions.saveAccount({ name: '悠遊卡', type: 'cash' }));
    expect(formProbe().accounts.split(',')).toContain('悠遊卡');
  });

  it('支付方式改名 → 付款下拉與支付統計同時換掉舊名稱', async () => {
    await mount();
    expect(paymentNames()).toContain('Cube');

    await run(() => actions.saveAccount({ name: '國泰 Cube', type: 'credit_card', credit_limit: 50000 }, 'a2'));

    expect(formProbe().accounts.split(',')).toContain('國泰 Cube');
    expect(formProbe().accounts.split(',')).not.toContain('Cube');
    // 舊交易的 payment_method 已被改寫，支付統計要跟著換
    expect(paymentNames()).toContain('國泰 Cube');
    expect(paymentNames()).not.toContain('Cube');
  });

  it('刪除沒有交易的支付方式 → 付款下拉立刻少一項', async () => {
    await mount();
    await run(() => actions.saveAccount({ name: '悠遊卡', type: 'cash' }));
    const added = actions.accounts.find((a) => a.name === '悠遊卡');

    await run(() => actions.deleteAccount(added.id));
    expect(formProbe().accounts.split(',')).not.toContain('悠遊卡');
  });

  it('改預設幣別 → 記帳表單的預設幣別立刻改變', async () => {
    await mount();
    expect(formProbe().currency).toBe('TWD');

    await run(() => actions.saveDefaultCurrency('JPY'));
    expect(formProbe().currency).toBe('JPY');
  });

  it('年檢視下改設定也要即時反映（年模式的資料另外查，不能漏掉）', async () => {
    localStorage.setItem('dashboard-granularity', 'year');
    await mount();
    expect(chartCats()).toContain('飲食');

    await run(() => actions.renameCategory('expense', '飲食', '吃飯'));
    expect(chartCats(), '年模式下分類改名後圖表沒更新').toContain('吃飯');
    expect(chartCats()).not.toContain('飲食');

    await run(() => actions.saveAccount({ name: '國泰 Cube', type: 'credit_card' }, 'a2'));
    expect(paymentNames(), '年模式下支付方式改名後支付統計沒更新').toContain('國泰 Cube');

    localStorage.clear();
  });
});
