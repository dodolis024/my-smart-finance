// 記帳要套用的匯率:以「交易日期」為準,而不是送出當下的現值。
// 補記上週的消費該用上週的匯率;用今天的會把當時的台幣金額記歪,而且事後看不出來。
//
// CLI 有一份同語意的實作(tools/core/transactions.js 的 resolveExchangeRate),
// 改這裡必須同步改那邊,否則網頁與 CLI 記同一天的帳會得到不同的台幣金額。
import { supabase } from '@/lib/supabase';

/**
 * 解析某一天的匯率(1 單位該幣別 = 多少 TWD)。取值順序:
 *   1. get_exchange_rate_on(幣別, 日期):歷史表裡「<= 該日期的最新一筆」
 *      (週末與排程停擺會留洞,所以是往前找而非精準比對)
 *   2. 歷史表最早一筆:歷史表 2026-09-09 才建立,早於它的舊帳查不到當日匯率,
 *      就用離那天最近的那一筆(往後找)——比用今天的現值接近
 *   3. exchange_rates 現值:連一列歷史都沒有的幣別(例如剛加進匯率表、排程還沒跑)
 *
 * 不在這裡 fallback 成 1:查不到要讓呼叫端擋下整筆,否則日圓 3000 會被記成台幣 3000。
 *
 * @param {string} currency 已正規化的大寫幣別代碼(TWD 由呼叫端自行處理)
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<{ rate: number|null, error: Object|null }>}
 *          error 是原始的 supabase error,呼叫端據此分辨「離線」與「查無資料」
 */
export async function fetchRateForDate(currency, date) {
  const { data: onDate, error } = await supabase.rpc('get_exchange_rate_on', {
    p_currency: currency,
    p_date: date,
  });
  if (error) return { rate: null, error };
  if (Number(onDate) > 0) return { rate: Number(onDate), error: null };

  const { data: earliest, error: earliestErr } = await supabase
    .from('exchange_rate_history')
    .select('rate')
    .eq('currency_code', currency)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (earliestErr) return { rate: null, error: earliestErr };
  if (Number(earliest?.rate) > 0) return { rate: Number(earliest.rate), error: null };

  const { data: live, error: liveErr } = await supabase.rpc('get_exchange_rate', {
    p_currency: currency,
  });
  if (liveErr) return { rate: null, error: liveErr };
  return { rate: Number(live) > 0 ? Number(live) : null, error: null };
}
