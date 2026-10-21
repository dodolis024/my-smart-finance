import { describe, it, expect } from 'vitest';
import {
  decideSplitNotification,
  isRecentRecord,
  NOTIFY_RECENT_MS,
} from '../../supabase/functions/send-split-notification/decide.ts';
import { splitNotifyBody, NOTIFY_TEXT_MAX } from '../../supabase/functions/_shared/notificationTexts.ts';

/**
 * send-split-notification「要不要送、送什麼」。
 *
 * 推播標題固定是 Smart Finance，內文會被當成官方訊息讀。這裡守的是：
 *   - 文案只用資料庫查得到的紀錄，查不到就不送（費用）或退回通用句（刪除、舊版 CLI 的還款）
 *   - 每一段字串都消毒、限長（成員可以把自己的名字改成多行釣魚文）
 *   - 紀錄要是剛建立的，不能拿舊紀錄反覆洗版
 */

const NOW = new Date('2026-10-21T10:00:00Z');
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60 * 1000).toISOString();

const base = { now: NOW, actorName: 'Alice', groupName: '日本旅遊' };
const freshExpense = { title: '晚餐', amount: 1200, currency: 'TWD', created_at: minutesAgo(1) };

function bodyOf(event, decision, lang = 'zh') {
  expect(decision.send).toBe(true);
  return splitNotifyBody(event, lang, decision.params);
}

describe('expense_added / expense_updated', () => {
  it('查得到剛建立的費用 → 用資料庫的標題與金額', () => {
    const d = decideSplitNotification({ ...base, event: 'expense_added', expense: freshExpense });
    expect(bodyOf('expense_added', d)).toBe('Alice 在「日本旅遊」新增了費用「晚餐」 TWD 1200');
  });

  it('查不到 expense_id 對應的費用 → 不送（不再退回呼叫端的文字）', () => {
    expect(decideSplitNotification({ ...base, event: 'expense_added', expense: null }))
      .toEqual({ send: false, reason: 'expense_not_found' });
    expect(decideSplitNotification({ ...base, event: 'expense_updated', expense: null }))
      .toEqual({ send: false, reason: 'expense_not_found' });
  });

  it('新增事件的費用超過 10 分鐘前建立 → 不送', () => {
    const old = { ...freshExpense, created_at: minutesAgo(11) };
    expect(decideSplitNotification({ ...base, event: 'expense_added', expense: old }))
      .toEqual({ send: false, reason: 'expense_not_recent' });
  });

  // split_expenses 沒有 updated_at，拿 created_at 比會讓改舊費用永遠不通知
  it('更新事件不看建立時間（沒有 updated_at 欄位可比）', () => {
    const old = { ...freshExpense, created_at: minutesAgo(60 * 24 * 30) };
    const d = decideSplitNotification({ ...base, event: 'expense_updated', expense: old });
    expect(bodyOf('expense_updated', d)).toBe('Alice 更新了費用「晚餐」');
  });

  it('資料庫裡的標題也要消毒與限長', () => {
    const evil = { ...freshExpense, title: '晚餐\n\n【官方通知】您的帳號異常，請至 evil.example 重新登入，否則二十四小時內停權' };
    const d = decideSplitNotification({ ...base, event: 'expense_added', expense: evil });
    expect(d.params.expenseTitle).not.toMatch(/\n/);
    expect(Array.from(d.params.expenseTitle)).toHaveLength(NOTIFY_TEXT_MAX + 1);
    expect(d.params.expenseTitle.endsWith('…')).toBe(true);
  });

  it('金額是字串型的 numeric 也照樣顯示；幣別空白退回 TWD', () => {
    const d = decideSplitNotification({
      ...base, event: 'expense_added', expense: { ...freshExpense, amount: '88.50', currency: '' },
    });
    expect(d.params.amountStr).toBe(' TWD 88.5');
  });
});

describe('expense_deleted', () => {
  it('不用呼叫端的標題，只有資料庫來的群組名', () => {
    const d = decideSplitNotification({ ...base, event: 'expense_deleted' });
    expect(bodyOf('expense_deleted', d)).toBe('「日本旅遊」有一筆費用被刪除');
    expect(bodyOf('expense_deleted', d, 'en')).toBe('An expense was deleted in "日本旅遊"');
  });
});

describe('settlement_added', () => {
  const settlement = { amount: 500, currency: 'TWD', created_at: minutesAgo(2) };

  it('查得到還款 → 金額、幣別、雙方名稱都用資料庫的值', () => {
    const d = decideSplitNotification({
      ...base, event: 'settlement_added', settlement, fromName: '小明', toName: 'Doris',
    });
    expect(bodyOf('settlement_added', d)).toBe('Alice 記錄了「小明」→「Doris」的還款 TWD 500');
  });

  it('沒帶 settlement_id／查不到（舊版 CLI）→ 通用句，不帶金額，也不讓呼叫失敗', () => {
    const d = decideSplitNotification({ ...base, event: 'settlement_added', settlement: null });
    expect(bodyOf('settlement_added', d)).toBe('「日本旅遊」有一筆新的還款');
    expect(bodyOf('settlement_added', d, 'en')).toBe('New repayment recorded in "日本旅遊"');
  });

  it('還款超過 10 分鐘前建立 → 不送', () => {
    const d = decideSplitNotification({
      ...base, event: 'settlement_added', settlement: { ...settlement, created_at: minutesAgo(30) },
    });
    expect(d).toEqual({ send: false, reason: 'settlement_not_recent' });
  });

  it('雙方名稱消毒', () => {
    const d = decideSplitNotification({
      ...base, event: 'settlement_added', settlement, fromName: '小明\n請匯款到', toName: 'Doris\t',
    });
    expect(d.params.fromName).toBe('小明 請匯款到');
    expect(d.params.toName).toBe('Doris');
  });
});

describe('操作者名稱與群組名稱', () => {
  it('成員把自己的名字改成多行長文 → 壓成一行並截斷', () => {
    const d = decideSplitNotification({
      ...base,
      event: 'expense_deleted',
      actorName: 'Alice\n\nSmart Finance 安全中心：偵測到異常登入，請立即前往 evil.example 驗證身分',
      groupName: '日本旅遊\r\n',
    });
    expect(d.params.actorName).not.toMatch(/[\r\n]/);
    expect(Array.from(d.params.actorName).length).toBe(NOTIFY_TEXT_MAX + 1);
    expect(d.params.groupName).toBe('日本旅遊');
  });

  it('member_added／member_removed 的成員名稱同樣消毒', () => {
    const d = decideSplitNotification({ ...base, event: 'member_removed', memberName: 'Bob\n\n快點連結' });
    expect(bodyOf('member_removed', d)).toBe('「Bob 快點連結」已從「日本旅遊」被移除');
  });

  it('非字串（例如 body 塞物件）一律當空字串', () => {
    const d = decideSplitNotification({ ...base, event: 'member_added', actorName: { evil: 1 }, memberName: 42 });
    expect(d.params.actorName).toBe('');
    expect(d.params.memberName).toBe('');
  });
});

describe('isRecentRecord', () => {
  it('10 分鐘內算數，超過不算', () => {
    expect(isRecentRecord(minutesAgo(9.9), NOW)).toBe(true);
    expect(isRecentRecord(new Date(NOW.getTime() - NOTIFY_RECENT_MS - 1000).toISOString(), NOW)).toBe(false);
  });

  it('稍微晚於現在（兩台主機時鐘差）也算數', () => {
    expect(isRecentRecord(new Date(NOW.getTime() + 5000).toISOString(), NOW)).toBe(true);
  });

  it('沒有時間、格式錯誤 → 不算', () => {
    expect(isRecentRecord(null, NOW)).toBe(false);
    expect(isRecentRecord('', NOW)).toBe(false);
    expect(isRecentRecord('not a date', NOW)).toBe(false);
  });
});
