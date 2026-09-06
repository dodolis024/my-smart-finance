import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 暴力亂搞：主畫面的期間切換整合流程。
 *
 * 前面的 periodFuzz 測的是選擇器與表格「元件本身」；這支測的是 DashboardPage 的接線，
 * 也就是真正會出事的地方：
 * - 快速連點不同年份時，晚回來的舊查詢不可以蓋掉新結果（yearReqIdRef 的競態保護）
 * - 年模式失敗時：離線要自動退回月模式，非離線要停在年模式顯示錯誤
 * - 不管在哪個粒度，月 RPC 都要照打（分類下拉／信用卡／簽到徽章只有它會回傳）
 * - 畫面上的統計數字永遠要對應「目前選定的期間」，不可以顯示上一個期間的殘影
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let seed = 424242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);
const pad = (n) => String(n).padStart(2, '0');

const TODAY = new Date();
const THIS_YEAR = TODAY.getFullYear();
const THIS_MONTH = TODAY.getMonth() + 1;
const todayYmd = `${THIS_YEAR}-${pad(THIS_MONTH)}-${pad(TODAY.getDate())}`;

/* ---------------- 假資料：每月 3 筆，金額 = 年*100 + 月，方便反推 ---------------- */
const DATASET = [];
for (const year of [THIS_YEAR - 2, THIS_YEAR - 1, THIS_YEAR]) {
  for (let month = 1; month <= 12; month++) {
    for (let k = 0; k < 3; k++) {
      const day = 1 + k * 10;
      const date = `${year}-${pad(month)}-${pad(day)}`;
      if (date > todayYmd) continue; // 未來的不造，避免與「年模式到今天為止」混淆
      DATASET.push({
        id: `${date}-${k}`,
        date,
        time: `1${k}:00:00`,
        type: 'expense',
        item_name: `${year}/${month} 第${k}筆`,
        category: pick(['飲食', '交通', '購物']),
        payment_method: pick(['現金', 'Cube']),
        currency: 'TWD',
        amount: 10,
        exchange_rate: 1,
        twd_amount: 10,
        note: null,
      });
    }
  }
}
const inRange = (start, end) => DATASET.filter((r) => r.date >= start && r.date <= end);
const monthRows = (y, m) => inRange(`${y}-${pad(m)}-01`, `${y}-${pad(m)}-31`);
const expectedExpense = (rows) => rows.reduce((s, r) => s + r.twd_amount, 0);

/* ---------------- supabase mock：可注入延遲與錯誤 ---------------- */
const h = vi.hoisted(() => ({
  rangeDelay: 0,        // 區間查詢的回應延遲（製造競態）
  rangeError: null,     // 設成物件即模擬查詢失敗
  rpcCalls: [],         // 記錄 get_dashboard_data 的參數
  rangeCalls: [],       // 記錄區間查詢的參數
  reset() { this.rangeDelay = 0; this.rangeError = null; this.rpcCalls = []; this.rangeCalls = []; },
}));

vi.mock('@/lib/supabase', () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    supabase: {
      rpc: async (name, args) => {
        if (name === 'get_dashboard_data') {
          h.rpcCalls.push({ year: args.p_year, month: args.p_month });
          const rows = globalThis.__monthRows(args.p_year, args.p_month);
          return {
            data: {
              success: true,
              summary: { totalIncome: 0, totalExpense: globalThis.__sum(rows), balance: -globalThis.__sum(rows) },
              history: rows.map(globalThis.__toCamel),
              accounts: [{ id: 'a1', accountName: 'Cube', type: 'credit_card', creditLimit: 50000 }],
              categoriesExpense: ['飲食', '交通', '購物'],
              categoriesIncome: ['薪水'],
              currentStreak: 3,
              streakBroken: false,
            },
            error: null,
          };
        }
        if (name === 'reconcile_streak_freezes') return { data: { consumedThisCall: 0 }, error: null };
        if (name === 'get_available_currencies') return { data: ['TWD'], error: null };
        return { data: null, error: null };
      },
      from: (table) => {
        const q = { table, filters: {}, limitN: null, wantCount: false, orders: [] };
        const b = {
          select: (_cols, opts) => { q.wantCount = opts?.count === 'exact'; return b; },
          eq: (col, val) => { q.filters[col] = val; return b; },
          gte: (_c, v) => { q.gte = v; return b; },
          lte: (_c, v) => { q.lte = v; return b; },
          order: (col, opts) => { q.orders.push([col, opts?.ascending]); return b; },
          limit: (n) => { q.limitN = n; return b; },
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async () => ({ error: null }),
          insert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
          delete: () => ({ eq: async () => ({ error: null }) }),
          then: (resolve) => resolve(run()),
        };
        const run = async () => {
          if (table !== 'transactions') return { data: [], count: 0, error: null };
          // 年份範圍查詢（只取一列、沒有 gte/lte）
          if (q.limitN === 1 && !q.gte) {
            const asc = q.orders[0]?.[1] !== false;
            const sorted = [...globalThis.__dataset].sort((x, y) => x.date.localeCompare(y.date));
            const row = asc ? sorted[0] : sorted[sorted.length - 1];
            return { data: row ? [{ date: row.date }] : [], count: 1, error: null };
          }
          // 區間查詢
          h.rangeCalls.push({ gte: q.gte, lte: q.lte, limit: q.limitN, count: q.wantCount });
          if (h.rangeDelay) await wait(h.rangeDelay);
          if (h.rangeError) return { data: null, count: null, error: h.rangeError };
          const rows = globalThis.__inRange(q.gte, q.lte);
          return { data: rows, count: rows.length, error: null };
        };
        return b;
      },
    },
  };
});

globalThis.__dataset = DATASET;
globalThis.__inRange = inRange;
globalThis.__monthRows = monthRows;
globalThis.__sum = expectedExpense;
globalThis.__toCamel = (r) => ({
  id: r.id, date: r.date, time: r.time, type: r.type, category: r.category,
  itemName: r.item_name, paymentMethod: r.payment_method, currency: r.currency,
  originalAmount: r.amount, exchangeRate: r.exchange_rate, twdAmount: r.twd_amount, note: r.note,
});

/* ---------------- 其餘外圍相依：只擋掉網路與畫布，邏輯全部走真的 ---------------- */
// context 的值在 provider 沒重繪時是穩定的，mock 也必須給同一個物件；
// 每次都給新物件會製造真實環境不存在的 effect 迴圈，測到的是假的
// 語系走真的字典，畫面上的期間標籤才是使用者真的看到的字（中文是「2026年9月」）
const DICT = { zh: (await import('@/locales/zh')).default, en: (await import('@/locales/en')).default };
const LANG = {
  lang: 'zh',
  t: (key, params) => {
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), DICT.zh);
    if (typeof val !== 'string') return val ?? key;
    return params
      ? val.replace(/\{(\w+)\}/g, (_, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`))
      : val;
  },
};
const TOAST = { success: () => {}, error: () => {}, info: () => {} };
const CONFIRM = { confirm: async () => true };
const AUTH = { user: { id: 'u1', email: 'x@y.z' }, ensureDefaultDataForOAuth: async () => {} };
const THEME = { theme: 'rose', setTheme: () => {} };
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => LANG }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => TOAST }));
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => CONFIRM }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => AUTH }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => THEME, THEMES: ['default', 'rose'] }));
// chart.js 在 jsdom 沒有 canvas；圓餅圖本身與粒度無關，換成只印筆數的替身
vi.mock('@/components/dashboard/CategoryChart', () => ({
  default: ({ history = [] }) => <div className="chart-stub" data-rows={history.length} />,
}));
vi.mock('@/components/layout/TopBar', () => ({ default: () => <div /> }));
vi.mock('@/components/transactions/TransactionForm', () => ({ default: () => <div /> }));
vi.mock('@/components/dashboard/YearlyReviewBanner', () => ({ default: () => <div /> }));

const DashboardPage = (await import('@/pages/DashboardPage')).default;

let container, root;
beforeEach(() => {
  h.reset();
  seed = 424242;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $ = (s) => container.querySelector(s);
const $$ = (s) => [...container.querySelectorAll(s)];
const click = (el) => { if (el) act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };
const settle = async (ms = 5) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async () => {
  await act(async () => { root.render(<DashboardPage />); });
  await settle();
};

/** 統計卡上的支出數字（去掉逗號與符號） */
const shownExpense = () => {
  const el = $$('.stat-card').map((c) => c.textContent).join(' ');
  const m = el.match(/-?[\d,]+/g) || [];
  return m.map((x) => Math.abs(Number(x.replace(/,/g, ''))));
};
const triggerLabel = () => $('.month-picker-trigger__label').textContent;
// 外顯的月／年切換鈕在面板外面，點它會順手關掉面板，所以每次要讀格子都得重開
const openPicker = () => { if (!$('.month-picker-popover')) click($('.month-picker-trigger')); };
const granularityTab = (i) => ($$('.period-picker-tab')[i] || $$('.period-toggle__btn')[i]);

describe('暴力亂搞：主畫面期間切換', () => {
  it('隨機切粒度／切年份／翻頁 120 回合，畫面數字永遠對應目前選定的期間', { timeout: 60000 }, async () => {
    await mount();
    const bad = [];
    const hit = { 切到年: 0, 切到月: 0, 選年份: 0, 選月份: 0, 翻頁: 0 };

    for (let round = 0; round < 120; round++) {
      const action = int(5);

      if (action === 0) { // 切年
        click(granularityTab(1));
        hit.切到年 += 1;
      } else if (action === 1) { // 切月
        click(granularityTab(0));
        hit.切到月 += 1;
      } else if (action === 2) { // 選一個可選的年份
        openPicker();
        const cells = $$('.month-picker-item').filter((c) => !c.disabled && /^\d{4}$/.test(c.textContent));
        if (cells.length) { click(pick(cells)); hit.選年份 += 1; }
      } else if (action === 3) { // 選一個月份
        openPicker();
        const cells = $$('.month-picker-item').filter((c) => !/^\d{4}$/.test(c.textContent));
        if (cells.length) { click(pick(cells)); hit.選月份 += 1; }
      } else { // 翻頁
        const btns = $$('.transaction-pager__btn').filter((b) => !b.disabled);
        if (btns.length) { click(pick(btns)); hit.翻頁 += 1; }
      }

      await settle();

      // 由觸發鈕標籤反推目前期間，再自己算一次期望的支出總額
      const label = triggerLabel();
      let rows;
      if (/^\d{4}$/.test(label)) {
        const y = Number(label);
        const end = y === THIS_YEAR ? todayYmd : `${y}-12-31`;
        rows = inRange(`${y}-01-01`, end);
      } else {
        const m0 = label.match(/^(\d{4})年(\d{1,2})月$/);
        if (!m0) { bad.push(`第 ${round} 回合：看不懂的期間標籤 ${label}`); continue; }
        rows = monthRows(Number(m0[1]), Number(m0[2]));
      }
      const want = expectedExpense(rows);
      if (!shownExpense().includes(want)) {
        bad.push(`第 ${round} 回合：期間 ${label} 應顯示支出 ${want}，畫面卻是 ${JSON.stringify(shownExpense())}`);
      }

      // 圓餅圖吃到的筆數也必須是同一個期間
      const chartRows = Number($('.chart-stub')?.dataset.rows ?? -1);
      if (chartRows !== -1 && chartRows !== rows.length) {
        bad.push(`第 ${round} 回合：期間 ${label} 有 ${rows.length} 筆，圓餅圖卻拿到 ${chartRows} 筆`);
      }
    }

    console.log('\n主畫面亂點覆蓋：', JSON.stringify(hit));
    expect(hit.切到年 + hit.選年份, '完全沒進到年模式').toBeGreaterThan(0);
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('快速連點不同年份，晚回來的舊查詢不可以蓋掉新結果', async () => {
    await mount();
    // 每次區間查詢都慢 40ms，連點就一定會重疊
    h.rangeDelay = 40;

    click(granularityTab(1));
    await settle();
    openPicker();

    const years = $$('.month-picker-item').filter((c) => !c.disabled && /^\d{4}$/.test(c.textContent));
    expect(years.length, '年份格狀裡至少要有兩個可選年份才測得到競態').toBeGreaterThan(1);

    // 不等回應，連續點三個不同年份（面板每次選完就關，要重開並重新抓節點）
    const targets = years.slice(0, 3).map((c) => c.textContent);
    for (const label of targets) {
      openPicker();
      click($$('.month-picker-item').find((c) => c.textContent === label));
    }
    const lastYear = Number(targets[2]);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });

    const end = lastYear === THIS_YEAR ? todayYmd : `${lastYear}-12-31`;
    const want = expectedExpense(inRange(`${lastYear}-01-01`, end));
    expect(triggerLabel()).toBe(String(lastYear));
    expect(shownExpense(), `最後點的是 ${lastYear}，畫面卻顯示別的年份的數字`).toContain(want);
  });

  it('不管在月模式還是年模式，月 RPC 都要照打（分類下拉／信用卡／簽到靠它）', async () => {
    localStorage.setItem('dashboard-granularity', 'year');
    await mount();

    expect(h.rpcCalls.length, '一進站就是年模式時，月 RPC 完全沒被呼叫').toBeGreaterThan(0);
    expect(h.rpcCalls.every((c) => c.year === THIS_YEAR && c.month === THIS_MONTH)).toBe(true);
    // 年模式仍要拿得到支付統計（accounts 來自月 RPC）
    expect($('.payment-stats-list, .payment-stats-empty')).not.toBeNull();
    expect(h.rangeCalls.length, '年模式沒有發出區間查詢').toBeGreaterThan(0);
    expect(h.rangeCalls[0].limit).toBe(5000);
    expect(h.rangeCalls[0].count).toBe(true);
  });

  it('年查詢失敗：離線退回月模式，非離線停在年模式', async () => {
    // 非離線錯誤 → 停在年模式
    h.rangeError = { message: 'boom' };
    await mount();
    click(granularityTab(1));
    await settle(40);
    expect(triggerLabel(), '非離線錯誤不該把使用者踢回月模式').toBe(String(THIS_YEAR));
    expect(localStorage.getItem('dashboard-granularity')).toBe('year');

    // 離線錯誤 → 自動退回月模式，並且把記住的粒度也改回月
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    h.rangeError = { message: 'Failed to fetch' };
    await mount();
    click(granularityTab(1));
    await settle(40);
    expect(triggerLabel(), '離線時應自動退回月模式').toMatch(/^\d{4}年\d{1,2}月$/);
    expect(localStorage.getItem('dashboard-granularity')).toBe('month');
  });
});
