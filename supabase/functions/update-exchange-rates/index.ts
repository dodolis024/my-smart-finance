// Supabase Edge Function: 每日自動更新匯率
// 此函數會呼叫外部匯率 API，並更新 exchange_rates 表

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { cronSecretGuard } from '../_shared/cronAuth.ts'
import { utcDateString } from './rateHistory.ts'
import { validateRates, MAX_CHANGE_PERCENT, STALE_AFTER_DAYS } from './validate.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 處理 CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // 只接受帶正確 x-cron-secret 的請求（pg_cron 排程）
  const unauthorized = cronSecretGuard(req, corsHeaders)
  if (unauthorized) return unauthorized

  try {
    // 初始化 Supabase client（使用 service role key 以便有寫入權限）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 使用免費的 Exchange Rate API
    // 註冊網址：https://www.exchangerate-api.com/
    const apiKey = Deno.env.get('EXCHANGE_RATE_API_KEY')
    
    if (!apiKey) {
      throw new Error('EXCHANGE_RATE_API_KEY not configured')
    }

    // 先取得目前資料庫中的匯率（Last Known Good）
    const { data: existingRates, error: fetchError } = await supabase
      .from('exchange_rates')
      .select('currency_code, rate, updated_at')

    const lastKnownGood: { [key: string]: number } = {}
    const lastUpdatedAt: { [key: string]: string } = {}
    if (!fetchError && existingRates) {
      existingRates.forEach(r => {
        lastKnownGood[r.currency_code] = r.rate
        lastUpdatedAt[r.currency_code] = r.updated_at
      })
    }

    // 預設 fallback 值（如果資料庫也沒有）
    const defaultRates = {
      TWD: 1.0,
      USD: 30.0,
      JPY: 0.2,
      EUR: 32.0,
      GBP: 38.0,
      KRW: 0.022,
    }

    // 以 TWD 為基準貨幣取得匯率，使用指數退避重試機制
    let response
    let data
    const maxRetries = 3
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(
          `https://v6.exchangerate-api.com/v6/${apiKey}/latest/TWD`,
          { signal: AbortSignal.timeout(15000) } // 15 秒超時
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        data = await response.json()

        if (data.result === 'success') {
          console.log(`Successfully fetched rates on attempt ${attempt}`)
          break
        } else {
          throw new Error(`API error: ${data['error-type']}`)
        }
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message)
        
        if (attempt === maxRetries) {
          // 所有重試都失敗，使用 Last Known Good
          console.log('All retries failed, using last known good rates')
          
          return new Response(
            JSON.stringify({
              success: false,
              message: 'Failed to fetch new rates, keeping existing rates',
              error: error.message,
              timestamp: new Date().toISOString(),
              using_last_known_good: true,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200, // 回傳 200 因為這不算失敗，只是保留舊資料
            }
          )
        }
        
        // 指數退避：5 秒、15 秒、45 秒（更長的間隔，避免過度請求）
        const backoffMs = 5000 * Math.pow(3, attempt - 1)
        console.log(`Waiting ${backoffMs}ms (${backoffMs/1000}s) before retry...`)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }

    // 從回傳的匯率中提取我們需要的幣別
    // 因為 API 回傳的是 1 TWD = X 外幣，我們需要反轉（1 外幣 = Y TWD）
    // 幣別清單動態決定：以資料庫現有幣別為準，聯集種子清單（首次啟動的後備），
    // 日後於 exchange_rates 新增幣別即自動納入更新，無需改動此函數。
    const rates = data.conversion_rates
    const defaultRatesMap = defaultRates as { [key: string]: number }
    const currencyCodes = Array.from(new Set([
      ...Object.keys(lastKnownGood),
      ...Object.keys(defaultRatesMap),
    ]))

    const newRates: { [key: string]: number } = { TWD: 1.0 }
    for (const cur of currencyCodes) {
      if (cur === 'TWD') continue
      // API 有回 → 反轉；否則退回舊值 / 種子值；都沒有則略過該幣別
      const v = rates[cur] ? (1 / rates[cur]) : (lastKnownGood[cur] ?? defaultRatesMap[cur])
      if (v != null) newRates[cur] = v
    }

    console.log('Fetched new exchange rates:', newRates)

    // 防呆機制：與 Last Known Good 比較，單日變動超過 ±20% 拒絕；舊值已陳舊則放行。
    // 規則與「被拒絕的幣別完全不寫」的理由見 validate.ts
    const now = new Date()
    const { toWrite, rejected, anomalies, decisions } = validateRates({
      newRates,
      lastKnownGood,
      lastUpdatedAt,
      now,
    })

    for (const d of decisions) {
      const pct = d.changePercent != null ? `${d.changePercent.toFixed(2)}%` : ''
      if (d.action === 'rejected') {
        console.error(
          `⚠️ ANOMALY DETECTED: ${d.currency} changed ${pct} ` +
          `(old: ${d.oldRate}, new: ${d.newRate}). Rejected; stored rate and updated_at left untouched.`
        )
      } else if (d.action === 'accepted_stale') {
        console.warn(
          `⚠️ ${d.currency} changed ${pct} (old: ${d.oldRate}, new: ${d.newRate}), ` +
          `but its stored rate is older than ${STALE_AFTER_DAYS} days ` +
          `(${d.staleSince ?? 'never'}). Accepting new rate.`
        )
      } else if (d.action === 'first_time') {
        console.log(`✓ ${d.currency}: First time setup, using ${d.newRate}`)
      } else if (d.action === 'accepted') {
        console.log(`✓ ${d.currency} changed ${pct} (old: ${d.oldRate}, new: ${d.newRate}). Accepted.`)
      }
    }

    console.log('Exchange rates to write:', toWrite)

    // 更新資料庫中的匯率（被拒絕的幣別不在 toWrite 裡，updated_at 保持原值）
    const updates = []
    for (const [currency, rate] of Object.entries(toWrite)) {
      const { error } = await supabase
        .from('exchange_rates')
        .upsert({
          currency_code: currency,
          rate: rate,
          updated_at: now.toISOString(),
        })

      if (error) {
        console.error(`Failed to update ${currency}:`, error)
        updates.push({ currency, success: false, error: error.message })
      } else {
        console.log(`Updated ${currency}: ${rate}`)
        updates.push({ currency, success: true, rate })
      }
    }

    // 歷史匯率：一天一列，供事後查詢「當時到底是多少」。
    // 只寫實際採用的幣別：被拒絕的幣別當天不寫，查詢是「<= 該日期的最新一筆」，
    // 自然沿用前一天的值——歷史表要跟系統的真相一致，不是跟 API 一致。
    const historyDate = utcDateString(now)
    const historyRows = Object.entries(toWrite).map(([currency_code, rate]) => ({
      currency_code,
      date: historyDate,
      rate,
    }))
    const { error: historyError } = historyRows.length > 0
      ? await supabase
          .from('exchange_rate_history')
          .upsert(historyRows, { onConflict: 'currency_code,date' })
      : { error: null }

    // 歷史寫入失敗不該讓整趟失敗：現值已經更新成功，記帳照常運作。
    // 但一定要留痕跡，否則歷史悄悄斷了好幾天完全看不出來。
    if (historyError) {
      console.error('Failed to record exchange rate history:', historyError.message)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: anomalies.length > 0
          ? `Exchange rates updated with ${anomalies.length} anomaly(ies) detected`
          : 'Exchange rates updated successfully',
        timestamp: new Date().toISOString(),
        updates,
        history: {
          date: historyDate,
          recorded: !historyError,
        },
        anomalies: anomalies.length > 0 ? anomalies : undefined,
        rejected: rejected.length > 0 ? rejected : undefined,
        warning: rejected.length > 0
          ? `Some rates changed more than ${MAX_CHANGE_PERCENT}% and were rejected. ` +
            'They were not written, so their updated_at keeps aging (badge after 3 days, ' +
            `stale override after ${STALE_AFTER_DAYS} days).`
          : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error updating exchange rates:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
