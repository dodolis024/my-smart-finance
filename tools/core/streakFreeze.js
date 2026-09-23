import { getTodayYmd } from './dates.js';

/**
 * 連續記帳凍結卡的對帳（補橋接缺口 + 發卡）。
 *
 * 發卡只發生在 reconcile_streak_freezes 裡，而它原本只有網頁在開 App 時呼叫。
 * 對只用 CLI 記帳的人來說等於從來不結算：記到第 10 天不會發卡，要等他哪天打開網頁；
 * 中間漏記一天，連續紀錄一斷，那張卡就再也發不出來（函數只看「目前」連續天數）。
 * 所以 CLI 只要簽到成功就跟著對帳一次。
 *
 * 失敗要吞掉：帳已經記進去了，對帳不成功不該讓它看起來像失敗。
 */
export async function reconcileStreakFreezes(client) {
  try {
    const { data, error } = await client.rpc('reconcile_streak_freezes', {
      p_client_today: getTodayYmd(),
    });
    if (error || !data?.success) return null;
    return data;
  } catch {
    return null;
  }
}
