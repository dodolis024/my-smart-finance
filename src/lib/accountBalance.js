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
 */

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
  return { initial, asOf, asOfTime };
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
 * @param {object} account 帳戶（RPC 或資料表格式皆可）
 * @param {Array} history  交易紀錄，需涵蓋設定時間之後的全部交易
 * @returns {{ initial: number, spent: number, received: number, balance: number,
 *            usedPercent: number, isOverdrawn: boolean } | null}
 */
export function calculateAccountBalance(account, history) {
  const settings = getBalanceSettings(account);
  if (!settings) return null;

  let spent = 0;
  let received = 0;
  for (const tx of history || []) {
    if (!matchesAccount(tx, account)) continue;
    const moment = txMoment(tx);
    if (Number.isNaN(moment) || moment <= settings.asOfTime) continue;
    const amount = typeof tx.twdAmount === 'number' ? tx.twdAmount : parseFloat(tx.twdAmount);
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
    initial: settings.initial,
    spent,
    received,
    balance,
    usedPercent,
    // 餘額為負刻意不夾在 0：顯示 0 會被讀成「剛好花完」，
    // 顯示負數才看得出「該更新錢包金額了」
    isOverdrawn: balance < 0,
  };
}
