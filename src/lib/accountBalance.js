/**
 * 帳戶餘額（現金錢包等非信用卡帳戶）
 *
 * 語意刻意與信用卡的「額度」不同：
 * - 信用卡：額度跟著帳單週期，每期繳完自動回滿（見 lib/creditCard.js）
 * - 這裡：餘額只跟著記帳走，永遠不會自己回復。想補錢就把設定的金額改掉。
 *
 * 餘額 = 使用者設定的金額 − 設定時間之後的支出 ＋ 設定時間之後的收入
 *
 * 「設定時間」要精確到時分秒，不能只比日期：使用者是在「數完錢包」的當下設定的，
 * 那個數字已經反映了當天稍早的消費。只比日期的話，早上那筆早餐會被重複扣一次。
 * 反過來，事後補記上週的舊帳也會落在設定時間之前而正確地不計入——那筆錢在他數
 * 鈔票的時候本來就已經不在錢包裡了。
 *
 * 但交易時間只記到「分」，設定時間記到秒：設定在 18:30:15、同一分鐘記的帳存成
 * 18:30:00，逐秒比會被當成設定之前而漏扣。所以設定時間先捨去到整分再比，同一分鐘
 * 的交易一律算在設定之後——剛設好餘額就記的帳，幾乎都是設定之後才花的。
 *
 * 幣別：餘額記在帳戶自己的幣別（balance_currency，未設定＝台幣），每筆交易先換成
 * 這個幣別再扣。換算沿用主畫面「顯示幣別」那一套（lib/displayCurrency.js 的 convertTx）：
 * - 帳戶是台幣 → 直接用 twd_amount，與加入幣別之前完全相同
 * - 交易與帳戶同幣別 → 用這筆記帳時凍結的匯率還原原幣，不受匯率漂移影響
 * - 不同幣別（例如拿台幣現金付英鎊的帳）→ 依交易當天的歷史匯率換算
 * 不能直接扣 twd_amount：英鎊錢包填 100、花 5 鎊會被扣掉約 200。
 */

import { convertTx, isRateTableUsable } from '@/lib/displayCurrency';
import { formatMoney, formatOriginalMoney } from '@/lib/utils';

/** 帳戶欄位可能來自 RPC（駝峰）或資料表（蛇形），兩種都要吃得到 */
export function getBalanceSettings(account) {
  if (!account) return null;
  const amount = account.balance_amount ?? account.balanceAmount;
  const asOf = account.balance_as_of ?? account.balanceAsOf;
  if (amount == null || amount === '' || !asOf) return null;
  const initial = typeof amount === 'number' ? amount : parseFloat(amount);
  if (!Number.isFinite(initial)) return null;
  const asOfTime = new Date(asOf).getTime();
  if (Number.isNaN(asOfTime)) return null;
  // 對齊交易時間的精度（見檔頭）。用 Date 捨去而不是對毫秒取整，避免時區偏移不是整分時出錯
  const asOfMinute = new Date(asOfTime);
  asOfMinute.setSeconds(0, 0);
  return { initial, asOf, asOfTime: asOfMinute.getTime(), currency: getBalanceCurrency(account) };
}

/** 餘額的幣別；舊帳戶沒有這個欄位，一律當台幣 */
export function getBalanceCurrency(account) {
  const code = account?.balance_currency ?? account?.balanceCurrency;
  return code ? String(code).toUpperCase() : 'TWD';
}

/**
 * 這筆要換算才扣得了、手上卻沒有匯率表。
 * 交易與帳戶同幣別時，convertTx 只用交易自己凍結的匯率，不需要匯率表。
 */
function needsMissingRates(tx, currency, rateTable) {
  if (currency === 'TWD') return false;
  if (String(tx.currency || 'TWD').toUpperCase() === currency) return false;
  return !isRateTableUsable(rateTable);
}

/** 單筆交易在帳戶幣別下的金額（呼叫前須先以 needsMissingRates 排除） */
function amountInCurrency(tx, currency, rateTable) {
  if (currency === 'TWD') {
    return typeof tx.twdAmount === 'number' ? tx.twdAmount : parseFloat(tx.twdAmount);
  }
  return convertTx(tx, currency, rateTable).value;
}

/** 這個帳戶有沒有在追蹤餘額（決定點下去要開哪個彈窗） */
export function hasBalanceTracking(account) {
  return getBalanceSettings(account) !== null;
}

/**
 * 交易發生的當下。transactions 的 date/time 是使用者當地的日期時間（無時區），
 * 這裡也用當地時間解讀，與設定餘額時記下的時間點同一個基準。
 */
function txMoment(tx) {
  if (!tx?.date) return NaN;
  return new Date(`${tx.date}T${tx.time || '00:00:00'}`).getTime();
}

function matchesAccount(tx, account) {
  const accountId = account.id;
  const accountName = account.name || account.accountName;
  // RPC 回傳的交易沒有 account_id，只能靠 payment_method 對名稱；
  // 直接查資料表拿到的則兩者都有。
  return (accountId && tx.account_id === accountId) || tx.paymentMethod === accountName;
}

/**
 * 算出帳戶目前餘額。沒有設定餘額的帳戶回傳 null。
 *
 * 回傳的金額全部是帳戶幣別（currency）。有交易需要換算、但匯率表還沒載入時，
 * ratesPending 為 true 且 balance 為 null：寧可先不顯示，也不要拿台幣數字冒充。
 *
 * @param {object} account   帳戶（RPC 或資料表格式皆可）
 * @param {Array} history    交易紀錄，需涵蓋設定時間之後的全部交易
 * @param {object} [rateTable] 帳戶幣別的匯率表（useRateTables），台幣帳戶不需要
 * @returns {{ currency: string, initial: number, spent: number, received: number,
 *            balance: number|null, usedPercent: number, isOverdrawn: boolean,
 *            ratesPending: boolean } | null}
 */
export function calculateAccountBalance(account, history, rateTable = null) {
  const settings = getBalanceSettings(account);
  if (!settings) return null;
  const { currency } = settings;

  let spent = 0;
  let received = 0;
  for (const tx of history || []) {
    if (!matchesAccount(tx, account)) continue;
    const moment = txMoment(tx);
    if (Number.isNaN(moment) || moment < settings.asOfTime) continue;
    if (tx.type !== 'income' && tx.type !== 'expense') continue;
    if (needsMissingRates(tx, currency, rateTable)) {
      return {
        currency, initial: settings.initial, spent: 0, received: 0, balance: null,
        usedPercent: 0, isOverdrawn: false, ratesPending: true,
      };
    }
    const amount = amountInCurrency(tx, currency, rateTable);
    if (!Number.isFinite(amount)) continue;
    // 只認明確的收入與支出。這裡不寫成「不是收入就當支出」——那個寫法在專案裡
    // 有好幾處，日後多出第三種交易類型時會被默默算成花費。
    if (tx.type === 'income') received += Math.abs(amount);
    else if (tx.type === 'expense') spent += Math.abs(amount);
  }

  const balance = settings.initial - spent + received;
  // 進度條的滿格是「最後一次設定的金額」；設 0 元時沒有比例可言，視為已用完
  const usedPercent = settings.initial > 0
    ? Math.min(100, Math.max(0, ((settings.initial - balance) / settings.initial) * 100))
    : 100;

  return {
    currency,
    initial: settings.initial,
    spent,
    received,
    balance,
    usedPercent,
    // 餘額為負刻意不夾在 0：顯示 0 會被讀成「剛好花完」，
    // 顯示負數才看得出「該更新錢包金額了」
    isOverdrawn: balance < 0,
    ratesPending: false,
  };
}

/** 餘額相關金額的顯示：台幣維持原本的 formatMoney（整數），其他幣別照該幣別的小數位 */
export function formatBalanceMoney(value, currency) {
  return !currency || currency === 'TWD' ? formatMoney(value) : formatOriginalMoney(value, currency);
}
