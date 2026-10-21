// @ts-nocheck
// 匯率防呆的純邏輯：決定每個幣別要接受、拒絕、還是因為舊值陳舊而放行。
// 無 Deno 專屬相依，供 index.ts（Deno）與 vitest（Node）共同 import。

// 單日變動超過這個百分比視為 API 異常，拒絕寫入
export const MAX_CHANGE_PERCENT = 20

// 舊匯率若已超過這麼多天沒更新，本身就不可信，此時不該讓 ±20% 防呆把它鎖住——
// 否則排程一旦停擺夠久（如 cron URL 壞掉那 53 天），累積偏移就會超過門檻，之後每天
// 「成功執行」卻永遠退回舊值。新增幣別時把 updated_at 設為過去時間（見
// database/supabase-migration.sql 的種子註解），即可走這條路徑，讓首次同步直接採用真實匯率。
export const STALE_AFTER_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export type RateAction = 'fixed' | 'first_time' | 'accepted' | 'accepted_stale' | 'rejected'

export interface RateDecision {
  currency: string
  action: RateAction
  oldRate: number | null
  newRate: number
  changePercent: number | null
  // 只有 accepted_stale 帶：舊值最後一次更新的時間（null = 從沒更新過）
  staleSince?: string | null
}

export interface RateValidation {
  // 要寫進 exchange_rates（含 updated_at）與當天 exchange_rate_history 的幣別與匯率
  toWrite: { [currency: string]: number }
  // 被拒絕、完全不寫的幣別
  rejected: string[]
  // 超過門檻的幣別（rejected 與 accepted_stale），沿用回傳 JSON 的既有格式
  anomalies: Array<{
    currency: string
    oldRate: number
    newRate: number
    changePercent: string
    action: 'rejected' | 'accepted_stale'
    staleSince?: string | null
  }>
  decisions: RateDecision[]
}

/** 舊值是否陳舊到不值得保護（沒有更新時間、或時間解析不了，都當作陳舊） */
export function isStaleRate(updatedAt: string | null | undefined, now: Date): boolean {
  if (!updatedAt) return true
  const parsed = new Date(updatedAt).getTime()
  return Number.isNaN(parsed) || parsed < now.getTime() - STALE_AFTER_DAYS * DAY_MS
}

/**
 * 逐幣別決定新匯率的去留。
 *
 * 被拒絕的幣別「完全不寫」：exchange_rates 不 upsert（updated_at 保持原值），
 * exchange_rate_history 也不寫當天那列（歷史查詢是「<= 該日期的最新一筆」，
 * 前一天的值會自然沿用）。這同時就是告警機制：
 *   - 連續被拒 3 天，前端首頁的「匯率已 N 天沒更新」徽章會亮（useRateStatus 看 updated_at）
 *   - 連續被拒 7 天，舊值變成陳舊，isStaleRate 成立，新值改走 accepted_stale 放行
 * 以前拒絕時仍把舊值連同 updated_at = now() 寫回去，等於每天把舊值「刷新」一次：
 * 徽章永遠不亮、陳舊放行永遠不觸發，幣別就永久鎖在舊值。
 */
export function validateRates({
  newRates,
  lastKnownGood,
  lastUpdatedAt,
  now,
}: {
  newRates: { [currency: string]: number }
  lastKnownGood: { [currency: string]: number }
  lastUpdatedAt: { [currency: string]: string }
  now: Date
}): RateValidation {
  const toWrite: { [currency: string]: number } = {}
  const rejected: string[] = []
  const anomalies: RateValidation['anomalies'] = []
  const decisions: RateDecision[] = []

  for (const [currency, newRate] of Object.entries(newRates)) {
    // 基準貨幣固定 1，不管 API 回什麼
    if (currency === 'TWD') {
      toWrite.TWD = 1.0
      decisions.push({ currency, action: 'fixed', oldRate: lastKnownGood.TWD ?? null, newRate: 1.0, changePercent: null })
      continue
    }

    const oldRate = lastKnownGood[currency]

    // 第一次設定，沒有舊匯率可比較，直接使用新匯率
    if (!(oldRate > 0)) {
      toWrite[currency] = newRate
      decisions.push({ currency, action: 'first_time', oldRate: null, newRate, changePercent: null })
      continue
    }

    const changePercent = Math.abs((newRate - oldRate) / oldRate * 100)

    if (changePercent <= MAX_CHANGE_PERCENT) {
      toWrite[currency] = newRate
      decisions.push({ currency, action: 'accepted', oldRate, newRate, changePercent })
      continue
    }

    const updatedAt = lastUpdatedAt[currency]
    if (isStaleRate(updatedAt, now)) {
      // 變動超過門檻，但舊匯率已陳舊到不值得保護，改為採用新匯率
      const staleSince = updatedAt ?? null
      toWrite[currency] = newRate
      decisions.push({ currency, action: 'accepted_stale', oldRate, newRate, changePercent, staleSince })
      anomalies.push({
        currency, oldRate, newRate,
        changePercent: changePercent.toFixed(2),
        action: 'accepted_stale',
        staleSince,
      })
      continue
    }

    // 變動超過門檻且舊值還新鮮：視為 API 異常，這個幣別今天完全不寫
    rejected.push(currency)
    decisions.push({ currency, action: 'rejected', oldRate, newRate, changePercent })
    anomalies.push({
      currency, oldRate, newRate,
      changePercent: changePercent.toFixed(2),
      action: 'rejected',
    })
  }

  return { toWrite, rejected, anomalies, decisions }
}
