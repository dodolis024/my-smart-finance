import { getAuthedClient } from './client.js';
import { fromSupabaseError } from './errors.js';

/**
 * 讀取整張匯率表（1 單位外幣 = 多少台幣），比照 src/pages/SplitPage.jsx 的讀法。
 *
 * 與記帳的 resolveExchangeRate 刻意不同：那邊查不到匯率會擋下整筆，
 * 因為記錯的台幣金額事後看不出來。結算這邊是唯讀的推算，calcSettlement 對查不到的
 * 幣別是 `?? 1` 退回原值——這是前端既有行為，照搬即可，不要改成擋下。
 */
export async function fetchRates() {
  const client = await getAuthedClient();
  const { data, error } = await client.from('exchange_rates').select('currency_code, rate');
  if (error) throw fromSupabaseError(error, '讀取匯率');

  const rates = { TWD: 1 };
  (data || []).forEach((row) => {
    rates[row.currency_code] = Number(row.rate);
  });
  return rates;
}
