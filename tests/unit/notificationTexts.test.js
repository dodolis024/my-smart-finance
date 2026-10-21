import { describe, it, expect } from 'vitest';
import {
  splitNotifyBody,
  creditReminderBody,
  usageAlertBody,
  subscriptionRateSkipBody,
  streakEmailSubject,
  streakEmailHtml,
  sanitizeNotifyText,
  NOTIFY_TEXT_MAX,
} from '../../supabase/functions/_shared/notificationTexts.ts';
import { normalizeLang } from '../../supabase/functions/_shared/userLang.ts';

describe('splitNotifyBody', () => {
  const p = {
    actorName: 'Alice',
    groupName: '日本旅遊',
    expenseTitle: '晚餐',
    memberName: 'Bob',
    fromName: 'Alice',
    toName: 'Bob',
    amountStr: ' TWD 1200',
    currency: 'TWD',
    expenseAmount: 1200,
  };

  it('expense_added: zh/en', () => {
    expect(splitNotifyBody('expense_added', 'zh', p)).toBe(
      'Alice 在「日本旅遊」新增了費用「晚餐」 TWD 1200'
    );
    expect(splitNotifyBody('expense_added', 'en', p)).toBe(
      'Alice added "晚餐" TWD 1200 in "日本旅遊"'
    );
  });

  it('expense_updated: zh/en', () => {
    expect(splitNotifyBody('expense_updated', 'zh', p)).toBe('Alice 更新了費用「晚餐」');
    expect(splitNotifyBody('expense_updated', 'en', p)).toBe('Alice updated "晚餐"');
  });

  // 費用已不在資料庫，標題只能信呼叫端，所以通用句刻意不帶標題
  it('expense_deleted: zh/en 只說群組裡有一筆費用被刪除', () => {
    expect(splitNotifyBody('expense_deleted', 'zh', p)).toBe('「日本旅遊」有一筆費用被刪除');
    expect(splitNotifyBody('expense_deleted', 'en', p)).toBe('An expense was deleted in "日本旅遊"');
  });

  it('member_added: zh/en', () => {
    expect(splitNotifyBody('member_added', 'zh', p)).toBe('Alice 將「Bob」加入了「日本旅遊」');
    expect(splitNotifyBody('member_added', 'en', p)).toBe('Alice added "Bob" to "日本旅遊"');
  });

  it('member_removed: zh/en', () => {
    expect(splitNotifyBody('member_removed', 'zh', p)).toBe('「Bob」已從「日本旅遊」被移除');
    expect(splitNotifyBody('member_removed', 'en', p)).toBe(
      '"Bob" was removed from "日本旅遊"'
    );
  });

  it('settlement_added: zh/en', () => {
    expect(splitNotifyBody('settlement_added', 'zh', p)).toBe(
      'Alice 記錄了「Alice」→「Bob」的還款 TWD 1200'
    );
    expect(splitNotifyBody('settlement_added', 'en', p)).toBe(
      'Alice recorded a repayment "Alice" → "Bob": TWD 1200'
    );
  });

  // 舊版 CLI 沒帶 settlement_id、或查不到還款紀錄：沒有可信的金額與人名
  it('settlement_added 沒有金額時退回通用句: zh/en', () => {
    const generic = { actorName: 'Alice', groupName: '日本旅遊', expenseAmount: null };
    expect(splitNotifyBody('settlement_added', 'zh', generic)).toBe('「日本旅遊」有一筆新的還款');
    expect(splitNotifyBody('settlement_added', 'en', generic)).toBe('New repayment recorded in "日本旅遊"');
  });

  it('未知 event 落 default: zh/en', () => {
    expect(splitNotifyBody('unknown_event', 'zh', p)).toBe('日本旅遊 有新的異動');
    expect(splitNotifyBody('unknown_event', 'en', p)).toBe('New activity in "日本旅遊"');
  });
});

describe('creditReminderBody', () => {
  it('due today: zh/en', () => {
    expect(creditReminderBody('zh', '國泰卡', 0)).toBe('「國泰卡」今天是繳款日，記得繳清！');
    expect(creditReminderBody('en', '國泰卡', 0)).toBe(
      '"國泰卡" payment is due today — don\'t forget to pay!'
    );
  });

  it('N 天後: zh/en 單複數', () => {
    expect(creditReminderBody('zh', '國泰卡', 3)).toBe('「國泰卡」還有 3 天到繳款日');
    expect(creditReminderBody('en', '國泰卡', 1)).toBe('"國泰卡" payment is due in 1 day');
    expect(creditReminderBody('en', '國泰卡', 3)).toBe('"國泰卡" payment is due in 3 days');
  });
});

describe('usageAlertBody', () => {
  it('warn: zh/en', () => {
    expect(usageAlertBody('zh', '國泰卡', 85, false)).toBe(
      '「國泰卡」使用率已達 85%，接近額度上限'
    );
    expect(usageAlertBody('en', '國泰卡', 85, false)).toBe(
      '"國泰卡" has reached 85% of its credit limit'
    );
  });

  it('over: zh/en', () => {
    expect(usageAlertBody('zh', '國泰卡', 105, true)).toBe(
      '「國泰卡」已超過信用額度（105%），請注意！'
    );
    expect(usageAlertBody('en', '國泰卡', 105, true)).toBe(
      '"國泰卡" is over its credit limit (105%)!'
    );
  });
});

describe('subscriptionRateSkipBody', () => {
  it('zh/en', () => {
    expect(subscriptionRateSkipBody('zh', 'Netflix', 'USD')).toBe(
      '「Netflix」今日扣款因無法取得 USD 匯率未自動入帳，請手動記錄'
    );
    expect(subscriptionRateSkipBody('en', 'Netflix', 'USD')).toBe(
      '"Netflix" wasn\'t charged today — USD exchange rate unavailable, please record it manually'
    );
  });
});

describe('streakEmailSubject / streakEmailHtml', () => {
  it('zh 版維持俏皮語氣', () => {
    expect(streakEmailSubject('zh')).toContain('你今天還沒記帳喔');
    expect(streakEmailHtml('zh')).toContain('還迷有');
  });

  it('en 版包含對應文字與按鈕連結', () => {
    expect(streakEmailSubject('en')).toContain("don't break your streak");
    expect(streakEmailHtml('en')).toContain('https://dodolis024.github.io/my-smart-finance/');
  });
});

describe('normalizeLang', () => {
  it('lang=en → en', () => {
    expect(normalizeLang({ lang: 'en' })).toBe('en');
  });

  it('lang=zh / {} / null / 意外值 → zh', () => {
    expect(normalizeLang({ lang: 'zh' })).toBe('zh');
    expect(normalizeLang({})).toBe('zh');
    expect(normalizeLang(null)).toBe('zh');
    expect(normalizeLang({ lang: 'fr' })).toBe('zh');
  });
});

describe('sanitizeNotifyText', () => {
  it('一般文字原樣通過', () => {
    expect(sanitizeNotifyText('晚餐')).toBe('晚餐');
    expect(sanitizeNotifyText('Team dinner')).toBe('Team dinner');
  });

  it('換行與 Tab 壓成單一空白，擋掉偽造的多行系統訊息', () => {
    expect(sanitizeNotifyText('晚餐\n\n您的帳號異常')).toBe('晚餐 您的帳號異常');
    expect(sanitizeNotifyText('a\tb')).toBe('a b');
  });

  it('清掉控制字元與行分隔符號', () => {
    expect(sanitizeNotifyText('晚餐\u0000\u007F\u2028後')).toBe('晚餐 後');
  });

  it('超過上限截斷並加省略號', () => {
    const long = 'x'.repeat(NOTIFY_TEXT_MAX + 20);
    const out = sanitizeNotifyText(long);
    expect(out).toHaveLength(NOTIFY_TEXT_MAX + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('上限是 40 字：放得下名字與標題，放不下一段釣魚文', () => {
    expect(NOTIFY_TEXT_MAX).toBe(40);
    const phishing = '系統通知：您的帳戶已被凍結，請立即點擊以下連結並輸入密碼以恢復使用權限，否則將於24小時內永久停用';
    const out = sanitizeNotifyText(phishing);
    expect(Array.from(out)).toHaveLength(41);
    expect(out).toBe(Array.from(phishing).slice(0, 40).join('') + '…');
  });

  it('多行釣魚名稱先壓成一行再截斷', () => {
    const name = 'Alice\n\n【Smart Finance 官方】\n您的帳號異常，請至 evil.example 重新登入以免停權';
    const out = sanitizeNotifyText(name);
    expect(out).not.toMatch(/[\n\r]/);
    expect(Array.from(out).length).toBeLessThanOrEqual(NOTIFY_TEXT_MAX + 1);
  });

  it('截斷不會把 emoji 切成半個', () => {
    const out = sanitizeNotifyText('😀'.repeat(NOTIFY_TEXT_MAX + 5));
    expect(out).toBe('😀'.repeat(NOTIFY_TEXT_MAX) + '…');
  });

  it('剛好等於上限不截斷', () => {
    const exact = 'x'.repeat(NOTIFY_TEXT_MAX);
    expect(sanitizeNotifyText(exact)).toBe(exact);
  });

  it('非字串一律回空字串', () => {
    expect(sanitizeNotifyText(null)).toBe('');
    expect(sanitizeNotifyText(undefined)).toBe('');
    expect(sanitizeNotifyText(123)).toBe('');
    expect(sanitizeNotifyText({ toString: () => 'evil' })).toBe('');
  });

  it('前後空白去掉', () => {
    expect(sanitizeNotifyText('  晚餐  ')).toBe('晚餐');
  });
});
