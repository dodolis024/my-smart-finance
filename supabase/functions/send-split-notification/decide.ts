// @ts-nocheck
// 分帳推播「要不要送、送什麼」的純邏輯：輸入是 index.ts 從資料庫查回來的紀錄，
// 輸出是 splitNotifyBody 要的參數，或不送的理由。
// 無 Deno 專屬相依，供 index.ts（Deno）與 vitest（Node）共同 import。
import { sanitizeNotifyText } from '../_shared/notificationTexts.ts'
import type { SplitTextParams } from '../_shared/notificationTexts.ts'

// 對應紀錄必須在這段時間內建立，才送推播。真實的新增是寫入後立刻呼叫，綽綽有餘；
// 有了它，同一筆紀錄只能在建立後的 10 分鐘內觸發推播，不能事後拿舊紀錄反覆洗版，
// 也就不需要另開一張表記「送過了沒」。
export const NOTIFY_RECENT_MS = 10 * 60 * 1000

export interface ExpenseRecord {
  title: string
  amount: number | string
  currency: string
  created_at: string
}

export interface SettlementRecord {
  amount: number | string
  currency: string
  created_at: string
}

export type SplitNotifyDecision =
  | { send: true; params: SplitTextParams }
  | { send: false; reason: string }

/** 紀錄的時間是否落在推播視窗內（前後各算，容許兩台主機的些微時鐘差） */
export function isRecentRecord(timestamp: unknown, now: Date, windowMs = NOTIFY_RECENT_MS): boolean {
  if (typeof timestamp !== 'string' || !timestamp) return false
  const t = new Date(timestamp).getTime()
  if (Number.isNaN(t)) return false
  return Math.abs(now.getTime() - t) <= windowMs
}

function toAmount(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 依事件與查到的紀錄決定要不要送、送什麼。所有字串在這裡統一消毒與限長。
 *
 * - expense_added / expense_updated：一定要查得到 expense_id 對應、屬於這個群組的費用，
 *   查不到就不送（不再退回呼叫端給的標題與金額）。
 *   expense_added 另外要求費用是最近 10 分鐘內建立的。expense_updated 做不到：
 *   split_expenses 沒有 updated_at 欄位，拿 created_at 比會讓「改一筆舊費用」永遠不通知。
 * - expense_deleted：資料已經不在，用不含呼叫端文字的通用句（只有群組名，來自資料庫）。
 *   刪除事件因此仍可被重複觸發，但每次內容都是同一句通用句。
 * - settlement_added：查得到 settlement_id 對應的還款 → 金額、幣別、雙方名稱都用資料庫的值，
 *   並要求是最近 10 分鐘內建立的；沒帶 settlement_id 或查不到（舊版 CLI 只送
 *   from_member／to_member／expense_amount）→ 退回不帶金額的通用句，不讓舊版呼叫失敗。
 * - member_added / member_removed / 其他：維持原本行為（名稱有查就用資料庫的值）。
 */
export function decideSplitNotification(input: {
  event: string
  now: Date
  actorName: unknown
  groupName: unknown
  expense?: ExpenseRecord | null
  settlement?: SettlementRecord | null
  fromName?: unknown
  toName?: unknown
  memberName?: unknown
}): SplitNotifyDecision {
  const { event, now } = input
  const base: SplitTextParams = {
    actorName: sanitizeNotifyText(input.actorName),
    groupName: sanitizeNotifyText(input.groupName),
  }

  switch (event) {
    case 'expense_added':
    case 'expense_updated': {
      const expense = input.expense
      if (!expense) return { send: false, reason: 'expense_not_found' }
      if (event === 'expense_added' && !isRecentRecord(expense.created_at, now)) {
        return { send: false, reason: 'expense_not_recent' }
      }
      const amount = toAmount(expense.amount)
      const currency = sanitizeNotifyText(expense.currency) || 'TWD'
      return {
        send: true,
        params: {
          ...base,
          expenseTitle: sanitizeNotifyText(expense.title),
          currency,
          expenseAmount: amount,
          amountStr: amount != null ? ` ${currency} ${amount}` : '',
        },
      }
    }

    case 'expense_deleted':
      return { send: true, params: base }

    case 'settlement_added': {
      const settlement = input.settlement
      const amount = settlement ? toAmount(settlement.amount) : null
      if (!settlement || amount == null) {
        // 通用句：expenseAmount 留空，splitNotifyBody 就不帶金額與人名
        return { send: true, params: { ...base, expenseAmount: null } }
      }
      if (!isRecentRecord(settlement.created_at, now)) {
        return { send: false, reason: 'settlement_not_recent' }
      }
      return {
        send: true,
        params: {
          ...base,
          fromName: sanitizeNotifyText(input.fromName),
          toName: sanitizeNotifyText(input.toName),
          currency: sanitizeNotifyText(settlement.currency) || 'TWD',
          expenseAmount: amount,
        },
      }
    }

    default:
      return { send: true, params: { ...base, memberName: sanitizeNotifyText(input.memberName) } }
  }
}
