import { describe, it, expect } from 'vitest';
import {
  splitNotifyBody,
  creditReminderBody,
  usageAlertBody,
  streakEmailSubject,
  streakEmailHtml,
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

  it('expense_deleted: zh/en', () => {
    expect(splitNotifyBody('expense_deleted', 'zh', p)).toBe('Alice 刪除了費用「晚餐」');
    expect(splitNotifyBody('expense_deleted', 'en', p)).toBe('Alice deleted "晚餐"');
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
