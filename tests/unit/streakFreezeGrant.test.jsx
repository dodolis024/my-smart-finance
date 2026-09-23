import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 凍結卡發卡時機。
 *
 * 發卡只發生在 reconcile_streak_freezes 裡，而它以前只在開 App 時呼叫一次。
 * 於是「在已開啟的頁面裡記到第 10 天」不會結算：隔天漏記、第三天再開 App 時
 * 連續紀錄已經歸零，函數看到的 streak 是 0，那張卡就再也發不出來。
 * 這支測的就是記帳與簽到之後有沒有補對帳。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  reconcileCalls: [],
  checkinUpserts: [],
  reset() { this.reconcileCalls = []; this.checkinUpserts = []; },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async (name, args) => {
      if (name === 'reconcile_streak_freezes') {
        h.reconcileCalls.push(args);
        return { data: { success: true, balance: 1, earnedTotal: 1, consumedThisCall: 0, consumedDates: [] }, error: null };
      }
      if (name === 'get_dashboard_data') {
        return {
          data: {
            success: true,
            summary: { totalIncome: 0, totalExpense: 0, balance: 0 },
            history: [],
            accounts: [],
            categoriesExpense: ['飲食'],
            categoriesIncome: ['薪水'],
            currentStreak: 10,
            streakBroken: false,
          },
          error: null,
        };
      }
      if (name === 'get_available_currencies') return { data: ['TWD'], error: null };
      return { data: null, error: null };
    },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        range: async () => ({ data: [], count: 0, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: async (row) => { if (table === 'checkins') h.checkinUpserts.push(row); return { error: null }; },
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        delete: () => ({ eq: async () => ({ error: null }) }),
        then: (resolve) => resolve({ data: [], count: 0, error: null }),
      };
      return b;
    },
  },
}));

const LANG = { lang: 'zh', t: (key) => key };
const TOAST = { success: () => {}, error: () => {}, info: () => {} };
const CONFIRM = { confirm: async () => true };
const AUTH = { user: { id: 'u1', email: 'x@y.z' }, ensureDefaultDataForOAuth: async () => {} };
const THEME = { theme: 'rose', setTheme: () => {} };
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => LANG }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => TOAST }));
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => CONFIRM }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => AUTH }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => THEME, THEMES: ['default', 'rose'] }));
vi.mock('@/components/dashboard/CategoryChart', () => ({ default: () => <div /> }));
vi.mock('@/components/layout/TopBar', () => ({ default: () => <div /> }));
vi.mock('@/components/dashboard/YearlyReviewBanner', () => ({ default: () => <div /> }));

// 表單本身不是這支的重點，換成兩顆按鈕直接觸發 dashboard 的兩條寫入路徑
vi.mock('@/components/transactions/TransactionForm', () => ({
  default: ({ onSubmit, onCheckin }) => (
    <div>
      <button
        className="stub-submit"
        onClick={() => onSubmit({
          itemName: '午餐', categoryValue: 'expense:飲食', paymentMethod: '現金',
          currency: 'TWD', amount: '100', date: globalThis.__today, time: '12:00', note: '',
        })}
      />
      <button className="stub-checkin" onClick={onCheckin} />
    </div>
  ),
}));

const DashboardPage = (await import('@/pages/DashboardPage')).default;
const { getTodayYmd } = await import('@/lib/utils');
globalThis.__today = getTodayYmd();

let container, root;
beforeEach(() => {
  h.reset();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async () => {
  await act(async () => { root.render(<DashboardPage />); });
  await settle();
};
const click = async (sel) => {
  const el = container.querySelector(sel);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

describe('凍結卡發卡對帳的觸發時機', () => {
  it('開 App 時對帳一次', async () => {
    await mount();
    expect(h.reconcileCalls.length).toBe(1);
    expect(h.reconcileCalls[0].p_client_today).toBe(globalThis.__today);
  });

  it('記帳成功後要再對帳一次（這筆可能剛好讓連續天數滿門檻）', async () => {
    await mount();
    const before = h.reconcileCalls.length;
    await click('.stub-submit');
    expect(h.checkinUpserts.length).toBe(1); // 這筆確實寫進了今天的簽到
    expect(h.reconcileCalls.length).toBe(before + 1);
  });

  it('按簽到後要再對帳一次', async () => {
    await mount();
    const before = h.reconcileCalls.length;
    await click('.stub-checkin');
    expect(h.reconcileCalls.length).toBe(before + 1);
  });
});
