// @ts-nocheck
// 通知文案集中管理（推播 body、Email 主旨/內文），依語言（zh/en）輸出對應字串。
// 無 Deno 專屬相依，供 index.ts（Deno）與 vitest（Node）共同 import。
import type { Lang } from './userLang.ts'

// ── 分帳群組推播（對應 send-split-notification 的六種 event）──
export interface SplitTextParams {
  actorName: string
  groupName: string
  expenseTitle?: string
  memberName?: string
  fromName?: string
  toName?: string
  // 原始碼既有格式：金額字串已含前導空白，例 " TWD 1200"；無金額時為 ''
  amountStr?: string
  currency?: string
  expenseAmount?: number | string | null
}

export function splitNotifyBody(event: string, lang: Lang, p: SplitTextParams): string {
  const amountStr = p.amountStr ?? ''
  if (lang === 'en') {
    switch (event) {
      case 'expense_added':
        return `${p.actorName} added "${p.expenseTitle}"${amountStr} in "${p.groupName}"`
      case 'expense_updated':
        return `${p.actorName} updated "${p.expenseTitle}"`
      case 'expense_deleted':
        return `${p.actorName} deleted "${p.expenseTitle}"`
      case 'member_added':
        return `${p.actorName} added "${p.memberName}" to "${p.groupName}"`
      case 'member_removed':
        return `"${p.memberName}" was removed from "${p.groupName}"`
      case 'settlement_added':
        return `${p.actorName} recorded a repayment "${p.fromName}" → "${p.toName}": ${p.currency || 'TWD'} ${p.expenseAmount}`
      default:
        return `New activity in "${p.groupName}"`
    }
  }
  switch (event) {
    case 'expense_added':
      return `${p.actorName} 在「${p.groupName}」新增了費用「${p.expenseTitle}」${amountStr}`
    case 'expense_updated':
      return `${p.actorName} 更新了費用「${p.expenseTitle}」`
    case 'expense_deleted':
      return `${p.actorName} 刪除了費用「${p.expenseTitle}」`
    case 'member_added':
      return `${p.actorName} 將「${p.memberName}」加入了「${p.groupName}」`
    case 'member_removed':
      return `「${p.memberName}」已從「${p.groupName}」被移除`
    case 'settlement_added':
      return `${p.actorName} 記錄了「${p.fromName}」→「${p.toName}」的還款 ${p.currency || 'TWD'} ${p.expenseAmount}`
    default:
      return `${p.groupName} 有新的異動`
  }
}

// ── 信用卡繳款日推播（send-credit-card-reminder）──
export function creditReminderBody(lang: Lang, cardName: string, daysUntilDue: number): string {
  if (lang === 'en') {
    return daysUntilDue === 0
      ? `"${cardName}" payment is due today — don't forget to pay!`
      : `"${cardName}" payment is due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`
  }
  return daysUntilDue === 0
    ? `「${cardName}」今天是繳款日，記得繳清！`
    : `「${cardName}」還有 ${daysUntilDue} 天到繳款日`
}

// ── 額度使用率推播（send-credit-usage-alert）──
export function usageAlertBody(lang: Lang, accountName: string, pctStr: number, isOver: boolean): string {
  if (lang === 'en') {
    return isOver
      ? `"${accountName}" is over its credit limit (${pctStr}%)!`
      : `"${accountName}" has reached ${pctStr}% of its credit limit`
  }
  return isOver
    ? `「${accountName}」已超過信用額度（${pctStr}%），請注意！`
    : `「${accountName}」使用率已達 ${pctStr}%，接近額度上限`
}

// ── 簽到提醒 Email（send-streak-reminder）──
export function streakEmailSubject(lang: Lang): string {
  return lang === 'en'
    ? "You haven't logged today — don't break your streak! 🔥"
    : '你今天還沒記帳喔！別讓連續紀錄中斷了 🔥'
}

export function streakEmailHtml(lang: Lang): string {
  if (lang === 'en') {
    return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
      <h2 style="color: #333; margin-bottom: 1rem;">Hello! Your reminder has arrived ✨</h2>
      <p style="color: #666; line-height: 1.6; font-size: 1rem;">
        You haven't logged anything or checked in today — record something soon or your streak will break!
      </p>
      <p style="color: #666; line-height: 1.6; font-size: 1rem;">
        Go log today's spending, or just hit the Check-in button to keep your streak alive!
      </p>
      <div style="margin-top: 1.5rem;">
        <a href="https://dodolis024.github.io/my-smart-finance/"
           style="display: inline-block; padding: 0.75rem 1.5rem; background: #b59c80; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          Log it now
        </a>
      </div>
      <p style="color: #999; font-size: 0.8rem; margin-top: 2rem;">
        You can turn this reminder off in My Smart Finance under More → Check-in Reminder.
      </p>
    </div>
  `
  }
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
      <h2 style="color: #333; margin-bottom: 1rem;">哈嚕！你的提醒已抵達 ✨</h2>
      <p style="color: #666; line-height: 1.6; font-size: 1rem;">
        你今天還迷有記帳或簽到，再不快點紀錄就要中斷了！
      </p>
      <p style="color: #666; line-height: 1.6; font-size: 1rem;">
        快去紀錄今天的花費，或者按一下 Check-in Button 來維持你的 streak 吧～！
      </p>
      <div style="margin-top: 1.5rem;">
        <a href="https://dodolis024.github.io/my-smart-finance/"
           style="display: inline-block; padding: 0.75rem 1.5rem; background: #b59c80; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          前往記帳
        </a>
      </div>
      <p style="color: #999; font-size: 0.8rem; margin-top: 2rem;">
        你可以在 My Smart Finance 的 更多->簽到提醒 關閉此提醒。
      </p>
    </div>
  `
}
