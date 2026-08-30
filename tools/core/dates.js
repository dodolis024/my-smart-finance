/**
 * 日期工具。
 *
 * 刻意與 src/lib/utils.js 的 getTodayYmd / getNowHm 保持逐字一致：
 * 兩邊都用「執行環境的本地時區」，簽到才會跟網頁判斷同一天。
 * 不要改成 UTC 或 toISOString()，那會讓台灣時間早上 8 點前記的帳被算成前一天。
 */

export function getTodayYmd() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNowHm() {
  const d = new Date();
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 驗證並正規化 YYYY-MM-DD；接受 today / yesterday 這類 agent 常用的相對詞 */
export function normalizeDate(input) {
  if (!input) return getTodayYmd();

  const value = String(input).trim().toLowerCase();
  if (value === 'today' || value === '今天') return getTodayYmd();
  if (value === 'yesterday' || value === '昨天') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (!YMD_PATTERN.test(value)) return null;
  // 擋掉 2026-02-31 這種格式合法但不存在的日期
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return value;
}

const HM_PATTERN = /^\d{2}:\d{2}$/;

export function normalizeTime(input) {
  if (!input) return getNowHm();
  const value = String(input).trim();
  if (!HM_PATTERN.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return value;
}
