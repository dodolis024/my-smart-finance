import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

/**
 * 暴力亂搞：期間粒度（月／年）與交易紀錄分頁。
 *
 * 守的是「難搞的使用者亂點也不能出事」的那幾條：
 * - 切粒度絕不能動到另一個粒度的錨點（使用者明確要求月與年各自記位置）
 * - 沒有資料／未來的年份無論怎麼點都選不到
 * - 分頁永遠不可以出現「有資料卻是空白頁」——這是切片寫錯位置的典型症狀
 * - 任何操作序列都不能讓畫面上的頁碼跑到有效範圍外
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
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) };
      return b;
    },
  },
}));

const PeriodPicker = (await import('@/components/dashboard/PeriodPicker')).default;
const TransactionTable = (await import('@/components/transactions/TransactionTable')).default;
const { getPeriodRange, getPeriodLabel, getPeriodFileLabel, isCurrentPeriod, getCurrentPeriod } =
  await import('@/lib/period');
const { buildQueuedRows } = await import('@/lib/offlineMerge');

let seed = 20260906;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);
const pad = (n) => String(n).padStart(2, '0');

let container, root;
beforeEach(() => {
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

/* ------------------------------------------------------------------ */
/* 1. 期間計算：亂丟年月進去，區間必須永遠自洽                          */
/* ------------------------------------------------------------------ */

describe('暴力亂搞：期間區間計算', () => {
  it('500 組隨機期間，日期區間永遠是合法且不重疊不漏日的', () => {
    const bad = [];
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const todayYear = new Date().getFullYear();

    for (let i = 0; i < 500; i++) {
      const year = 1990 + int(46); // 1990 ~ 2035，含未來年份
      const month = 1 + int(12);
      const granularity = pick(['month', 'year']);
      const period = granularity === 'year'
        ? { granularity: 'year', year }
        : { granularity: 'month', year, month };

      let range;
      try {
        range = getPeriodRange(period);
      } catch (err) {
        bad.push(`getPeriodRange 拋錯 ${JSON.stringify(period)}: ${err.message}`);
        continue;
      }

      // 不管丟什麼進去，出來的一定是兩個合法日期字串
      if (!YMD.test(range.startDate)) bad.push(`起日格式壞掉 ${JSON.stringify(period)} → ${range.startDate}`);
      if (!YMD.test(range.endDate)) bad.push(`迄日格式壞掉 ${JSON.stringify(period)} → ${range.endDate}`);

      // 標籤永遠不能吐出 undefined / NaN
      for (const label of [getPeriodLabel(period), getPeriodFileLabel(period)]) {
        if (/undefined|NaN/.test(label)) bad.push(`標籤壞掉 ${JSON.stringify(period)} → ${label}`);
      }

      if (granularity === 'month') {
        const lastDay = new Date(year, month, 0).getDate();
        if (range.startDate !== `${year}-${pad(month)}-01`) bad.push(`月起日錯 ${range.startDate}`);
        if (range.endDate !== `${year}-${pad(month)}-${pad(lastDay)}`) bad.push(`月迄日錯 ${range.endDate}`);
        if (range.startDate > range.endDate) bad.push(`月區間顛倒 ${JSON.stringify(range)}`);
      } else if (year < todayYear) {
        if (range.startDate !== `${year}-01-01` || range.endDate !== `${year}-12-31`) {
          bad.push(`過去年份不是整年 ${JSON.stringify(range)}`);
        }
      } else if (year === todayYear) {
        if (range.endDate.slice(0, 4) !== String(todayYear)) bad.push(`當年度迄日跑掉 ${range.endDate}`);
        if (range.startDate > range.endDate) bad.push(`當年度區間顛倒 ${JSON.stringify(range)}`);
      }

      // isCurrentPeriod 與 getCurrentPeriod 必須互相對得起來
      if (!isCurrentPeriod(getCurrentPeriod(granularity))) bad.push(`getCurrentPeriod 不是當期 ${granularity}`);
    }

    // 任一年的 12 個月串起來，必須剛好覆蓋 1/1 ~ 12/31，不重疊也不漏日
    for (let i = 0; i < 20; i++) {
      const year = 1990 + int(46);
      let cursor = `${year}-01-01`;
      for (let m = 1; m <= 12; m++) {
        const { startDate, endDate } = getPeriodRange({ granularity: 'month', year, month: m });
        if (startDate !== cursor) bad.push(`${year}/${m} 月區間沒接上：預期 ${cursor}、實際 ${startDate}`);
        const next = new Date(`${endDate}T00:00:00`);
        next.setDate(next.getDate() + 1);
        cursor = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
      }
      if (cursor !== `${year + 1}-01-01`) bad.push(`${year} 年 12 個月沒有剛好蓋滿整年，收在 ${cursor}`);
    }

    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. 離線佇列的日期區間過濾：字串比較不可以跟真實日期比較不一致        */
/* ------------------------------------------------------------------ */

describe('暴力亂搞：離線佇列的區間過濾', () => {
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const randomDate = () => ymd(new Date(2024 + int(4), int(12), 1 + int(28)));

  it('400 組隨機日期與區間，字串比較的結果必須等於真實日期比較', () => {
    const bad = [];
    for (let round = 0; round < 400; round++) {
      const items = Array.from({ length: int(12) }, (_, i) => ({
        id: `q${i}`,
        status: 'pending',
        tx: { id: `q${i}`, date: randomDate(), item_name: `x${i}`, twd_amount: 1, type: 'expense' },
      }));
      const a = randomDate();
      const b = randomDate();
      const [startDate, endDate] = a <= b ? [a, b] : [b, a];

      const got = buildQueuedRows(items, startDate, endDate).map((r) => r.id);
      const want = items
        .filter((it) => {
          const t = Date.parse(it.tx.date + 'T00:00:00');
          return t >= Date.parse(startDate + 'T00:00:00') && t <= Date.parse(endDate + 'T00:00:00');
        })
        .map((it) => it.id);

      if (JSON.stringify(got) !== JSON.stringify(want)) {
        bad.push(`區間 ${startDate}~${endDate}：字串比較得到 ${got}、真實日期比較得到 ${want}`);
      }
    }
    expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('餵髒資料（沒有日期、空字串、null、亂字串）不可以崩潰', () => {
    const junk = [
      { id: 'a', status: 'pending', tx: {} },
      { id: 'b', status: 'pending', tx: { date: '' } },
      { id: 'c', status: 'pending', tx: { date: null } },
      { id: 'd', status: 'pending', tx: { date: '亂七八糟' } },
      { id: 'e', status: 'pending', tx: { date: undefined } },
      { id: 'f', status: 'failed', tx: { id: 'f', date: '2026-09-06' } },
    ];
    expect(() => buildQueuedRows(junk, '2026-01-01', '2026-12-31')).not.toThrow();
    const rows = buildQueuedRows(junk, '2026-01-01', '2026-12-31');
    expect(rows.map((r) => r.id)).toEqual(['f']);
  });
});

/* ------------------------------------------------------------------ */
/* 3. 期間選擇器：亂點頁籤、箭頭、格子、外面                            */
/* ------------------------------------------------------------------ */

/** 完整重現 DashboardPage 的錨點接線（月與年各記各的） */
function PickerHarness({ yearRange }) {
  const [granularity, setGranularity] = useState('month');
  const [monthAnchor, setMonthAnchor] = useState({ year: 2026, month: 9 });
  const [yearAnchor, setYearAnchor] = useState({ year: 2026 });

  const period = granularity === 'year'
    ? { granularity: 'year', year: yearAnchor.year }
    : { granularity: 'month', year: monthAnchor.year, month: monthAnchor.month };

  const handlePeriodChange = useCallback((next) => {
    if (next.granularity === 'year') setYearAnchor({ year: next.year });
    else setMonthAnchor({ year: next.year, month: next.month });
  }, []);

  return (
    <div>
      <i className="state" data-state={JSON.stringify({ granularity, monthAnchor, yearAnchor })} />
      <PeriodPicker
        period={period}
        onChange={handlePeriodChange}
        onGranularityChange={setGranularity}
        yearRange={yearRange}
      />
    </div>
  );
}

describe('暴力亂搞：期間選擇器', () => {
  const THIS_YEAR = new Date().getFullYear();
  const state = () => JSON.parse($('.state').dataset.state);
  const label = () => $('.month-picker-trigger__label').textContent;

  const expectedLabel = (s) => (s.granularity === 'year'
    ? String(s.yearAnchor.year)
    : `${s.monthAnchor.year}年${s.monthAnchor.month}月`);

  it('400 回合隨機點擊：錨點只會被「選格子」動到，且永遠選不到停用的年份', () => {
    const yearRange = { minYear: 2024, maxYear: 2026 };
    const selectable = (y) => y <= THIS_YEAR && y >= yearRange.minYear && y <= yearRange.maxYear;
    act(() => { root.render(<PickerHarness yearRange={yearRange} />); });

    const bad = [];
    const hit = { 選月份: 0, 選年份: 0, 點到停用的年份: 0, 切粒度: 0, 回本期: 0, 翻年份組: 0 };
    // 不會動到錨點的操作：開關面板、切頁籤、翻年份、點外面
    const NON_ANCHOR = [
      () => click($('.month-picker-trigger')),
      () => click($$('.period-picker-tab')[0]),
      () => click($$('.period-picker-tab')[1]),
      () => click($$('.month-picker-year-btn')[0]),
      () => click($$('.month-picker-year-btn')[1]),
      () => act(() => document.dispatchEvent(new MouseEvent('click', { bubbles: true }))),
    ];

    for (let round = 0; round < 400; round++) {
      const before = state();
      const useAnchorAction = rnd() < 0.35;

      if (useAnchorAction) {
        // 點格子（含被停用的年份格）或「回這個月／回這一年」
        const target = rnd() < 0.8 ? pick($$('.month-picker-item')) : $('.month-picker-today');
        if (target?.classList.contains('month-picker-today')) hit.回本期 += 1;
        else if (target?.classList.contains('is-empty')) hit.點到停用的年份 += 1;
        else if (target && before.granularity === 'year') hit.選年份 += 1;
        else if (target) hit.選月份 += 1;
        click(target);
        const after = state();
        if (after.granularity !== before.granularity) bad.push(`第 ${round} 回合：點格子竟然換了粒度`);
        if (before.granularity === 'month' && JSON.stringify(after.yearAnchor) !== JSON.stringify(before.yearAnchor)) {
          bad.push(`第 ${round} 回合：在月模式操作卻動到年錨點 ${JSON.stringify(before.yearAnchor)} → ${JSON.stringify(after.yearAnchor)}`);
        }
        if (before.granularity === 'year' && JSON.stringify(after.monthAnchor) !== JSON.stringify(before.monthAnchor)) {
          bad.push(`第 ${round} 回合：在年模式操作卻動到月錨點 ${JSON.stringify(before.monthAnchor)} → ${JSON.stringify(after.monthAnchor)}`);
        }
      } else {
        const idx = int(NON_ANCHOR.length);
        if (idx === 1 || idx === 2) hit.切粒度 += 1;
        if (idx === 3 || idx === 4) hit.翻年份組 += 1;
        NON_ANCHOR[idx]();
        const after = state();
        if (JSON.stringify(after.monthAnchor) !== JSON.stringify(before.monthAnchor)
          || JSON.stringify(after.yearAnchor) !== JSON.stringify(before.yearAnchor)) {
          bad.push(`第 ${round} 回合：切頁籤/翻頁/點外面竟然動到錨點`);
        }
      }

      const s = state();
      // 年錨點永遠不可以落在停用的年份上（未來年份、資料範圍外）
      if (!selectable(s.yearAnchor.year)) {
        bad.push(`第 ${round} 回合：選到了停用的年份 ${s.yearAnchor.year}`);
      }
      // 月錨點永遠合法
      if (!(s.monthAnchor.month >= 1 && s.monthAnchor.month <= 12) || !Number.isInteger(s.monthAnchor.year)) {
        bad.push(`第 ${round} 回合：月錨點壞掉 ${JSON.stringify(s.monthAnchor)}`);
      }
      // 觸發鈕標籤永遠跟著狀態走
      if (label() !== expectedLabel(s)) {
        bad.push(`第 ${round} 回合：標籤 ${label()} 與狀態 ${JSON.stringify(s)} 對不起來`);
      }
      // 面板不可以同時開出兩個
      if ($$('.month-picker-popover').length > 1) bad.push(`第 ${round} 回合：跑出多個面板`);
    }

    // 印出覆蓋率，避免這個測試看起來過了、其實根本沒點到東西
    console.log('\n期間選擇器亂點覆蓋：', JSON.stringify(hit));
    expect(hit.點到停用的年份, '沒有真的點到停用的年份，這輪 fuzz 沒有測到擋選的邏輯').toBeGreaterThan(0);
    expect(hit.選年份 + hit.選月份, '完全沒有選到任何期間').toBeGreaterThan(0);
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });

  it('全新帳號（完全沒有交易）亂點也選得到今年，但選不到未來', () => {
    act(() => { root.render(<PickerHarness yearRange={null} />); });
    const bad = [];
    for (let round = 0; round < 200; round++) {
      pick([
        () => click($('.month-picker-trigger')),
        () => click($$('.period-picker-tab')[1]),
        () => click(pick($$('.month-picker-item'))),
        () => click($('.month-picker-today')),
      ])();
      const s = state();
      if (s.yearAnchor.year > THIS_YEAR) bad.push(`第 ${round} 回合：選到未來年份 ${s.yearAnchor.year}`);
    }
    expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. 交易紀錄分頁：亂翻頁 + 亂篩選 + 資料一直換                        */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 50;
const CATS = ['飲食', '交通', '購物', '娛樂'];
const PAYS = ['現金', 'Cube', 'Mom'];
const makeRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: `t${i}`,
  date: '2026-09-01',
  time: '12:00:00',
  type: 'expense',
  category: CATS[i % CATS.length],
  itemName: `項目${i}`,
  paymentMethod: PAYS[i % PAYS.length],
  currency: 'TWD',
  amount: 100,
  twdAmount: 100,
  note: null,
}));

/** 完整重現 DashboardPage 的分頁接線 */
function TableHarness({ transactions }) {
  const [visibleRowCount, setVisibleRowCount] = useState(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visibleRowCount / PAGE_SIZE));

  useEffect(() => { setPage((p) => (p > totalPages ? totalPages : p)); }, [totalPages]);
  const resetPage = useCallback(() => setPage(1), []);

  return (
    <div>
      <i className="state" data-state={JSON.stringify({ page, totalPages, visibleRowCount })} />
      <button className="go-prev" onClick={() => setPage((p) => Math.max(1, p - 1))}>prev</button>
      <button className="go-next" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>next</button>
      <TransactionTable
        transactions={transactions}
        page={page}
        pageSize={PAGE_SIZE}
        onVisibleCountChange={setVisibleRowCount}
        onFilterChange={resetPage}
      />
    </div>
  );
}

describe('暴力亂搞：交易紀錄分頁', () => {
  const state = () => JSON.parse($('.state').dataset.state);
  const rowIds = () => $$('tbody tr[data-id]').map((tr) => tr.dataset.id);

  it('400 回合隨機翻頁／篩選／換資料，永遠不會出現「有資料卻空白」的頁', () => {
    let data = makeRows(137);
    act(() => { root.render(<TableHarness transactions={data} />); });

    const bad = [];
    const hit = { 翻到第二頁以後: 0, 改篩選: 0, 換資料: 0, 篩到空: 0 };
    const openFilter = (kind) => click($(`button[data-filter="${kind}"]`));

    for (let round = 0; round < 400; round++) {
      const action = int(7);
      if (action === 0) click($('.go-next'));
      else if (action === 1) click($('.go-prev'));
      else if (action === 2) { openFilter(pick(['category', 'payment'])); click(pick($$('.filter-popover__list input'))); }
      else if (action === 3) { openFilter(pick(['category', 'payment'])); click($$('.filter-popover__action')[0]); }
      else if (action === 4) { openFilter(pick(['category', 'payment'])); click($$('.filter-popover__action')[1]); }
      else if (action === 5) {
        // 專挑分頁邊界值：0/1 筆、剛好一頁、多一筆、剛好兩頁…
        // 小筆數也順便製造「原本選的分類在新資料裡不存在」→ 篩選後 0 筆的狀態
        data = makeRows(pick([0, 1, 2, 3, 49, 50, 51, 99, 100, 101, 137, 200]));
        act(() => { root.render(<TableHarness transactions={data} />); });
        hit.換資料 += 1;
      }
      else click(pick($$('tbody tr[data-id]'))); // 亂點某一列（會開詳情彈窗）
      if (action >= 2 && action <= 4) hit.改篩選 += 1;

      const s = state();
      if (s.page > 1) hit.翻到第二頁以後 += 1;
      if (s.visibleRowCount === 0) hit.篩到空 += 1;
      const ids = rowIds();

      // 頁碼永遠在有效範圍內
      if (s.page < 1 || s.page > s.totalPages) bad.push(`第 ${round} 回合：頁碼 ${s.page} 超出 1~${s.totalPages}`);
      // 一頁最多 PAGE_SIZE 筆
      if (ids.length > PAGE_SIZE) bad.push(`第 ${round} 回合：一頁 ${ids.length} 筆，超過 ${PAGE_SIZE}`);
      // 只要篩選後還有資料，畫面就不可以是空的（切片位置寫錯的典型症狀）
      if (s.visibleRowCount > 0 && ids.length === 0) {
        bad.push(`第 ${round} 回合：篩選後有 ${s.visibleRowCount} 筆，第 ${s.page}/${s.totalPages} 頁卻是空白`);
      }
      // 當頁筆數必須剛好等於該頁應有的筆數
      const expected = s.visibleRowCount === 0
        ? 0
        : Math.max(0, Math.min(PAGE_SIZE, s.visibleRowCount - (s.page - 1) * PAGE_SIZE));
      if (ids.length !== expected) {
        bad.push(`第 ${round} 回合：第 ${s.page}/${s.totalPages} 頁應有 ${expected} 筆，實際 ${ids.length} 筆（篩選後共 ${s.visibleRowCount}）`);
      }
      // 同一頁不可以有重複的列
      if (new Set(ids).size !== ids.length) bad.push(`第 ${round} 回合：同一頁出現重複的交易`);
      // 顯示的列必須都來自目前的資料，且維持原本的先後順序
      const idx = ids.map((id) => data.findIndex((r) => r.id === id));
      if (idx.some((i) => i < 0)) bad.push(`第 ${round} 回合：畫面上出現不存在於資料中的列`);
      if (idx.some((v, i) => i > 0 && v <= idx[i - 1])) bad.push(`第 ${round} 回合：列的順序亂掉`);
    }

    console.log('分頁亂點覆蓋：', JSON.stringify(hit));
    expect(hit.翻到第二頁以後, '從來沒翻到第 2 頁，這輪 fuzz 沒測到分頁').toBeGreaterThan(0);
    expect(hit.改篩選, '從來沒改過表頭篩選').toBeGreaterThan(0);
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });

  it('資料在翻到後面幾頁時被抽光，不可以崩潰也不可以卡在空白頁', () => {
    const bad = [];
    act(() => { root.render(<TableHarness transactions={makeRows(200)} />); });
    click($('.go-next'));
    click($('.go-next'));
    click($('.go-next'));
    expect(state().page).toBe(4);

    for (const size of [200, 51, 50, 1, 0, 137, 0, 300]) {
      act(() => { root.render(<TableHarness transactions={makeRows(size)} />); });
      const s = state();
      const ids = rowIds();
      if (s.page < 1 || s.page > s.totalPages) bad.push(`資料剩 ${size} 筆時頁碼 ${s.page}/${s.totalPages} 越界`);
      if (s.visibleRowCount > 0 && ids.length === 0) bad.push(`資料剩 ${size} 筆時停在空白頁`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
