import { formatMoney, formatMoneyInteger, formatOriginalMoney } from '@/lib/utils';

// 主畫面「顯示幣別」的換算與格式化（純函式，由 DisplayAmountContext 包成 hook 提供給元件）。
//
// 所有匯率的語意都是「1 單位該幣別 = 多少 TWD」（exchange_rates、exchange_rate_history、
// transactions.exchange_rate 皆同），所以一律以 twd_amount 為錨點換算：
//   1. 交易本身就是顯示幣別 → 用這筆記帳時凍結的匯率反推，得到「原幣＋手續費」，不受匯率漂移影響
//   2. 其他幣別 → 除以顯示幣別「交易當天」的歷史匯率（當天沒有就往前找最近一筆，同 get_exchange_rate_on）
//   3. 歷史表起點（2026-09-09）以前查不到 → 退回今日匯率，標記為估算（畫面不加符號，只在滑鼠提示說明）
// 顯示幣別是台幣時完全不換算，數字與加入這個功能之前一致。

/** 歷史匯率表（依日期升冪的 [date, rate]）中，date 當天或之前最近的一筆；查無回 null */
export function rateOnOrBefore(history, date) {
  if (!Array.isArray(history) || history.length === 0 || !date) return null;
  let lo = 0;
  let hi = history.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // 'YYYY-MM-DD' 是定長格式，字串比較即等同日期比較
    if (history[mid][0] <= date) {
      found = history[mid][1];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 匯率表是否足以換算：至少要有歷史或今日匯率其中之一 */
export function isRateTableUsable(table) {
  return Boolean(table) && ((table.history?.length ?? 0) > 0 || Number(table.live) > 0);
}

/** 記帳時輸入的原幣金額；欄位來源不一（RPC 駝峰、離線佇列 amount），取法比照 TransactionDetail */
export function originalAmountOf(tx) {
  if (tx.originalAmount != null) return tx.originalAmount;
  if (tx.amount != null) return tx.amount;
  return tx.twdAmount;
}

/**
 * 單筆交易換算成顯示幣別。
 * @returns {{ value: number, estimated: boolean }}
 */
export function convertTx(tx, currency, table) {
  const twd = Number(tx.twdAmount) || 0;
  if (currency === 'TWD') return { value: twd, estimated: false };

  if (String(tx.currency || 'TWD').toUpperCase() === currency) {
    const frozen = Number(tx.exchangeRate);
    if (frozen > 0) return { value: twd / frozen, estimated: false };
    // 缺凍結匯率（理論上不會發生）：退回原幣金額，至少跟使用者輸入的一致
    return { value: Number(originalAmountOf(tx)) || 0, estimated: false };
  }

  const historical = rateOnOrBefore(table?.history, tx.date);
  if (historical > 0) return { value: twd / historical, estimated: false };
  const live = Number(table?.live);
  if (live > 0) return { value: twd / live, estimated: true };
  // 呼叫端應已用 isRateTableUsable 擋掉這種情況；保險起見當作 0 並標估算
  return { value: 0, estimated: true };
}

/**
 * 依顯示偏好與匯率表，組出元件用的換算／格式化工具。
 * 匯率還沒載入（或該幣別完全沒有匯率）時，整個畫面暫以台幣顯示，不會出現半換算的混合數字。
 */
export function buildDisplayAmount(preferences, table) {
  const { amountMode } = preferences;
  const currency =
    preferences.currency === 'TWD' || isRateTableUsable(table) ? preferences.currency : 'TWD';

  const toDisplay = (tx) => convertTx(tx, currency, table);

  /** 加總用的金額字串；prefix 放正負號（每日小計的 +／-） */
  const formatTotal = (value, { prefix = '' } = {}) => {
    // 台幣：比照原本 StatCards 的 Math.round + formatMoney
    const text = currency === 'TWD' ? formatMoney(Math.round(value)) : formatOriginalMoney(value, currency);
    return `${prefix}${text}`;
  };

  /** 單筆交易的金額字串與是否為估算 */
  const describeTxAmount = (tx, { isMobile = false } = {}) => {
    if (amountMode === 'original') {
      return { text: formatOriginalMoney(originalAmountOf(tx), tx.currency), estimated: false };
    }
    if (currency === 'TWD') {
      return { text: isMobile ? formatMoneyInteger(tx.twdAmount) : formatMoney(tx.twdAmount), estimated: false };
    }
    const { value, estimated } = toDisplay(tx);
    return { text: formatOriginalMoney(value, currency), estimated };
  };

  /**
   * 收入／支出／結餘，與 get_dashboard_data 的彙總同義，只是單位換成顯示幣別。
   * 估算旗標收入、支出分開記（供統計卡的滑鼠提示），結餘兩者有一即算
   */
  const sumTransactions = (rows) => {
    let totalIncome = 0;
    let totalExpense = 0;
    let incomeEstimated = false;
    let expenseEstimated = false;
    for (const tx of rows || []) {
      const r = toDisplay(tx);
      if (tx.type === 'income') {
        totalIncome += r.value;
        if (r.estimated) incomeEstimated = true;
      } else {
        totalExpense += r.value;
        if (r.estimated) expenseEstimated = true;
      }
    }
    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      incomeEstimated,
      expenseEstimated,
      estimated: incomeEstimated || expenseEstimated,
    };
  };

  return {
    currency,
    amountMode,
    toDisplay,
    formatTotal,
    describeTxAmount,
    formatTxAmount: (tx, opts) => describeTxAmount(tx, opts).text,
    sumTransactions,
  };
}
