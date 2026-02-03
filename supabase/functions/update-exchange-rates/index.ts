// Supabase Edge Function: 每日自動更新匯率
// 此函數會呼叫外部匯率 API，並更新 exchange_rates 表

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 處理 CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 初始化 Supabase client（使用 service role key 以便有寫入權限）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    // 驗證請求（可選）- 允許沒有驗證的請求，因為這是定時任務
    // 如果需要更嚴格的安全性，可以添加自定義的 secret token
    
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
      .select('currency_code, rate')
    
    const lastKnownGood: { [key: string]: number } = {}
    if (!fetchError && existingRates) {
      existingRates.forEach(r => {
        lastKnownGood[r.currency_code] = r.rate
      })
    }

    // 預設 fallback 值（如果資料庫也沒有）
    const defaultRates = {
      TWD: 1.0,
      USD: 30.0,
      JPY: 0.2,
      EUR: 32.0,
      GBP: 38.0,
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
    const rates = data.conversion_rates
    const newRates: { [key: string]: number } = {
      TWD: 1.0,
      USD: rates.USD ? (1 / rates.USD) : (lastKnownGood.USD || defaultRates.USD),
      JPY: rates.JPY ? (1 / rates.JPY) : (lastKnownGood.JPY || defaultRates.JPY),
      EUR: rates.EUR ? (1 / rates.EUR) : (lastKnownGood.EUR || defaultRates.EUR),
      GBP: rates.GBP ? (1 / rates.GBP) : (lastKnownGood.GBP || defaultRates.GBP),
    }

    console.log('Fetched new exchange rates:', newRates)

    // 防呆機制：檢查新匯率與 Last Known Good 的變動範圍
    // 如果變動超過 ±20%，拒絕更新並記錄錯誤
    const MAX_CHANGE_PERCENT = 20
    const anomalies = []
    const validatedRates: { [key: string]: number } = { TWD: 1.0 }

    for (const [currency, newRate] of Object.entries(newRates)) {
      if (currency === 'TWD') {
        validatedRates[currency] = 1.0
        continue
      }

      const oldRate = lastKnownGood[currency]
      
      if (oldRate && oldRate > 0) {
        const changePercent = Math.abs((newRate - oldRate) / oldRate * 100)
        
        if (changePercent > MAX_CHANGE_PERCENT) {
          // 變動超過 20%，視為異常，保留舊匯率
          console.error(
            `⚠️ ANOMALY DETECTED: ${currency} changed ${changePercent.toFixed(2)}% ` +
            `(old: ${oldRate}, new: ${newRate}). Keeping old rate.`
          )
          anomalies.push({
            currency,
            oldRate,
            newRate,
            changePercent: changePercent.toFixed(2),
            action: 'rejected',
          })
          validatedRates[currency] = oldRate // 保留舊匯率
        } else {
          // 變動在合理範圍內，使用新匯率
          console.log(
            `✓ ${currency} changed ${changePercent.toFixed(2)}% ` +
            `(old: ${oldRate}, new: ${newRate}). Accepted.`
          )
          validatedRates[currency] = newRate
        }
      } else {
        // 第一次設定，沒有舊匯率可比較，直接使用新匯率
        console.log(`✓ ${currency}: First time setup, using ${newRate}`)
        validatedRates[currency] = newRate
      }
    }

    console.log('Validated exchange rates:', validatedRates)

    // 更新資料庫中的匯率
    const updates = []
    for (const [currency, rate] of Object.entries(validatedRates)) {
      const { error } = await supabase
        .from('exchange_rates')
        .upsert({
          currency_code: currency,
          rate: rate,
          updated_at: new Date().toISOString(),
        })

      if (error) {
        console.error(`Failed to update ${currency}:`, error)
        updates.push({ currency, success: false, error: error.message })
      } else {
        console.log(`Updated ${currency}: ${rate}`)
        updates.push({ currency, success: true, rate })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: anomalies.length > 0 
          ? `Exchange rates updated with ${anomalies.length} anomaly(ies) detected`
          : 'Exchange rates updated successfully',
        timestamp: new Date().toISOString(),
        updates,
        anomalies: anomalies.length > 0 ? anomalies : undefined,
        warning: anomalies.length > 0 
          ? 'Some rates changed more than 20% and were rejected. Last known good rates were kept.'
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
