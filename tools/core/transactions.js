import { getAuthedClient, getCurrentUser } from './client.js';
import { listAccounts, resolveAccount } from './accounts.js';
import { resolveCategory } from './categories.js';
import { getTodayYmd, normalizeDate, normalizeTime } from './dates.js';
import { ErrorCode, fromSupabaseError, smfError } from './errors.js';
import { getOverseasFeeRate, getOverseasAutoCheck, computeTwdWithFee } from './overseasFee.js';
import { reconcileStreakFreezes } from './streakFreeze.js';

/**
 * ⚠️ 這個檔案是 src/hooks/useTransactions.js 寫入邏輯的第二份實作。
 * 兩邊必須保持一致，否則從 CLI 記的帳會跟網頁記的帳算出不同的台幣金額。
 * 修改前請先看 tools/README.md 的「同步義務」一節。
 */

// transactions.amount 與 twd_amount 都是 NUMERIC(10,2)，超過會被資料庫擋下，
// 但 PostgREST 的錯誤訊息對 agent 很難懂，所以提前擋並給清楚訊息
const MAX_AMOUNT = 99999999.99;

const TX_FIELDS = 'id, date, time, type, item_name, category, payment_method, account_id, currency, amount, exchange_rate, twd_amount, overseas_fee_rate, overseas_fee, note';

export function parseAmount(rawAmount) {
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') {
    throw smfError(ErrorCode.INVALID_INPUT, '必須指定金額');
  }
  // 與前端 parseFormattedNumber 一致：容許使用者輸入含千分位逗號的金額
  const amount = parseFloat(String(rawAmount).replace(/,/g, ''));

  if (isNaN(amount) || amount <= 0) {
    throw smfError(ErrorCode.INVALID_INPUT, `金額必須是大於 0 的數字（收到：${rawAmount}）`);
  }
  if (amount > MAX_AMOUNT) {
    throw smfError(ErrorCode.INVALID_INPUT, `金額超出上限（最大 ${MAX_AMOUNT}）`);
  }
  return amount;
}

/**
 * 取匯率。
 *
 * 查無匯率時「擋下整筆」是刻意的：get_exchange_rate 查不到會回 NULL 而不是 1.0，
 * 就是為了讓呼叫端能區分「真的是 1:1」和「沒有這個幣別的資料」。
 * 若在這裡 fallback 成 1，日圓 3000 會被記成台幣 3000，而且事後幾乎看不出來。
 */
async function resolveExchangeRate(client, currency) {
  if (currency === 'TWD') return 1.0;

  const { data, error } = await client.rpc('get_exchange_rate', { p_currency: currency });

  if (error || data == null || Number(data) <= 0) {
    throw smfError(
      ErrorCode.RATE_UNAVAILABLE,
      `查不到 ${currency} 的匯率，為避免記成錯誤金額已停止寫入`,
      '請確認幣別代碼正確（例如 JPY、USD、GBP），或改用 TWD 記帳'
    );
  }
  return Number(data);
}

const OVERSEAS_NO_RATE_HINT = '請使用者先到網頁的帳戶設定填寫手續費率，或拿掉 --overseas';

/**
 * 決定這筆要套用的海外手續費率。
 * overseas: true（--overseas）/ false（--no-overseas）/ undefined（沒表態 → 依帳戶預設）
 * 網頁版在這些情況下勾選框根本不會出現；CLI 的使用者是 agent，靜默忽略會讓它以為手續費記上了，所以明確報錯。
 */
function resolveOverseasFeeRate({ overseas, account, currency, type }) {
  const rate = getOverseasFeeRate(account);
  if (type === 'income') {
    if (overseas === true) {
      throw smfError(ErrorCode.INVALID_INPUT, '收入不適用海外手續費', '拿掉 --overseas');
    }
    return null;
  }
  if (overseas === false) return null;
  if (overseas === true) {
    if (rate == null) {
      throw smfError(ErrorCode.INVALID_INPUT, `帳戶「${account.name}」沒有設定海外手續費率`, OVERSEAS_NO_RATE_HINT);
    }
    return rate;
  }
  return rate != null && getOverseasAutoCheck(account) && currency !== 'TWD' ? rate : null;
}

/**
 * 新增一筆交易。
 * 對應 src/hooks/useTransactions.js 的 submitTransaction（新增分支）。
 */
export async function addTransaction(input) {
  const { itemName, amount: rawAmount, category, type = null, account, currency = 'TWD', date, time, note, overseas } = input;

  if (!String(itemName || '').trim()) {
    throw smfError(ErrorCode.INVALID_INPUT, '必須指定項目名稱');
  }
  const amount = parseAmount(rawAmount);

  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) {
    throw smfError(ErrorCode.INVALID_INPUT, `日期格式錯誤（收到：${date}）`, '請使用 YYYY-MM-DD，或 today / yesterday');
  }
  const normalizedTime = normalizeTime(time);
  if (!normalizedTime) {
    throw smfError(ErrorCode.INVALID_INPUT, `時間格式錯誤（收到：${time}）`, '請使用 HH:MM 24 小時制');
  }

  const normalizedCurrency = String(currency).trim().toUpperCase();

  const client = await getAuthedClient();
  const user = await getCurrentUser();

  const resolvedCategory = await resolveCategory(category, type);
  const resolvedAccount = await resolveAccount(account);
  const exchangeRate = await resolveExchangeRate(client, normalizedCurrency);
  const feeRate = resolveOverseasFeeRate({
    overseas, account: resolvedAccount, currency: normalizedCurrency, type: resolvedCategory.type,
  });
  const { overseasFee, twdAmount } = computeTwdWithFee(amount, exchangeRate, feeRate);

  const transactionData = {
    user_id: user.id,
    date: normalizedDate,
    time: normalizedTime,
    type: resolvedCategory.type,
    item_name: String(itemName).trim(),
    category: resolvedCategory.category,
    // payment_method 是向後相容的冗餘欄位，與 account_id 兩個都要填
    payment_method: resolvedAccount.name,
    account_id: resolvedAccount.id,
    currency: normalizedCurrency,
    amount,
    exchange_rate: exchangeRate,
    twd_amount: twdAmount,
    overseas_fee_rate: overseasFee == null ? null : feeRate,
    overseas_fee: overseasFee,
    note: note || null,
  };

  const { data, error } = await client.from('transactions').insert(transactionData).select(TX_FIELDS).single();
  if (error) throw fromSupabaseError(error, '新增交易');

  const checkedIn = await maybeCheckIn(client, user.id, normalizedDate);

  return { transaction: data, checkedIn };
}

/**
 * 簽到。
 *
 * 三個條件缺一不可：新增（非編輯）、寫入成功、交易日期就是今天。
 * 補記昨天的帳不算簽到，這是已定案的產品決策，不要「順手優化」成補簽。
 * 失敗要吞掉：簽到不成功不該讓一筆已經記好的帳看起來像失敗。
 */
async function maybeCheckIn(client, userId, date) {
  if (date !== getTodayYmd()) return false;

  const { error } = await client
    .from('checkins')
    .upsert({ user_id: userId, date, source: 'onTimeTransaction' }, { onConflict: 'user_id,date' });

  if (error) return false;

  // 這筆可能讓連續天數剛好滿發卡門檻，當場對帳才發得出來
  await reconcileStreakFreezes(client);
  return true;
}

export async function getTransaction(id) {
  if (!String(id || '').trim()) {
    throw smfError(ErrorCode.INVALID_INPUT, '必須指定交易 id');
  }

  const client = await getAuthedClient();
  const { data, error } = await client.from('transactions').select(TX_FIELDS).eq('id', id).maybeSingle();

  if (error) throw fromSupabaseError(error, '讀取交易');
  if (!data) {
    throw smfError(ErrorCode.NOT_FOUND, `找不到 id 為 ${id} 的交易`, '請先用 list_transactions 查出正確的 id');
  }
  return data;
}

/** 查詢交易；預設回傳最近 20 筆 */
export async function listTransactions(options = {}) {
  const { month, year, from, to, type, category, search, limit = 20 } = options;

  const client = await getAuthedClient();
  let query = client.from('transactions').select(TX_FIELDS);

  if (month || year) {
    const now = new Date();
    const y = Number(year) || now.getFullYear();
    const m = Number(month) || now.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    query = query
      .gte('date', `${y}-${String(m).padStart(2, '0')}-01`)
      .lte('date', `${y}-${String(m).padStart(2, '0')}-${lastDay}`);
  }
  if (from) {
    const normalized = normalizeDate(from);
    if (!normalized) throw smfError(ErrorCode.INVALID_INPUT, `from 日期格式錯誤（收到：${from}）`);
    query = query.gte('date', normalized);
  }
  if (to) {
    const normalized = normalizeDate(to);
    if (!normalized) throw smfError(ErrorCode.INVALID_INPUT, `to 日期格式錯誤（收到：${to}）`);
    query = query.lte('date', normalized);
  }
  if (type) {
    if (type !== 'expense' && type !== 'income') {
      throw smfError(ErrorCode.INVALID_INPUT, 'type 只能是 expense 或 income');
    }
    query = query.eq('type', type);
  }
  if (category) query = query.eq('category', category);
  if (search) query = query.ilike('item_name', `%${search}%`);

  // 與網頁列表相同的排序：同一天多筆依時間排，時間相同才看建立順序
  const { data, error } = await query
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .limit(Math.min(Number(limit) || 20, 200));

  if (error) throw fromSupabaseError(error, '查詢交易');
  return data || [];
}

/**
 * 修改一筆交易。
 *
 * 匯率的處理是這裡最容易寫錯的地方：幣別沒變就沿用原本的匯率，不可重新查今日匯率，
 * 否則只是改個備註，就會用今天的匯率改寫幾個月前那筆的台幣金額（對應 useTransactions.js 的匯率鎖定）。
 *
 * 海外手續費同理：沒給 patch.overseas 就維持原本狀態，帳戶沒換就沿用當時的費率；
 * 編輯不套用帳戶預設（CLI 看不到畫面，自動改動較難察覺）。
 */
export async function updateTransaction(id, patch = {}) {
  const existing = await getTransaction(id);
  const client = await getAuthedClient();

  const nextCurrency = patch.currency
    ? String(patch.currency).trim().toUpperCase()
    : String(existing.currency).toUpperCase();

  const updates = {};

  if (patch.itemName !== undefined) {
    if (!String(patch.itemName).trim()) throw smfError(ErrorCode.INVALID_INPUT, '項目名稱不可為空');
    updates.item_name = String(patch.itemName).trim();
  }

  if (patch.date !== undefined) {
    const normalized = normalizeDate(patch.date);
    if (!normalized) throw smfError(ErrorCode.INVALID_INPUT, `日期格式錯誤（收到：${patch.date}）`);
    updates.date = normalized;
  }

  if (patch.time !== undefined) {
    const normalized = normalizeTime(patch.time);
    if (!normalized) throw smfError(ErrorCode.INVALID_INPUT, `時間格式錯誤（收到：${patch.time}）`);
    updates.time = normalized;
  }

  if (patch.category !== undefined || patch.type !== undefined) {
    const resolved = await resolveCategory(patch.category ?? existing.category, patch.type ?? null);
    updates.category = resolved.category;
    updates.type = resolved.type;
  }

  if (patch.account !== undefined) {
    const resolved = await resolveAccount(patch.account);
    updates.payment_method = resolved.name;
    updates.account_id = resolved.id;
  }

  if (patch.note !== undefined) updates.note = patch.note || null;

  const nextType = updates.type ?? existing.type;
  const accountChanged = patch.account !== undefined && updates.account_id !== existing.account_id;
  const wasOverseas = existing.overseas_fee_rate != null;
  let wantOverseas = patch.overseas !== undefined ? patch.overseas : wasOverseas;

  if (nextType === 'income') {
    if (patch.overseas === true) throw smfError(ErrorCode.INVALID_INPUT, '收入不適用海外手續費', '拿掉 --overseas');
    wantOverseas = false;
  }
  if (wantOverseas && !wasOverseas) {
    // 分帳同步交易重新同步時 RPC 會改寫 twd_amount，手續費會被洗掉，所以不支援
    const { data: sync } = await client.from('split_ledger_syncs').select('id').eq('transaction_id', id).maybeSingle();
    if (sync) throw smfError(ErrorCode.INVALID_INPUT, '分帳同步進來的交易不支援海外手續費', '拿掉 --overseas');
  }

  let nextFeeRate = null;
  if (wantOverseas) {
    if (!accountChanged && wasOverseas) {
      nextFeeRate = Number(existing.overseas_fee_rate);
    } else {
      const accounts = await listAccounts();
      const nextAccount = accounts.find((a) => a.id === (updates.account_id ?? existing.account_id))
        || accounts.find((a) => a.name === (updates.payment_method ?? existing.payment_method));
      nextFeeRate = getOverseasFeeRate(nextAccount);
      if (nextFeeRate == null && patch.overseas === true) {
        throw smfError(
          ErrorCode.INVALID_INPUT,
          `帳戶「${nextAccount?.name ?? existing.payment_method}」沒有設定海外手續費率`,
          OVERSEAS_NO_RATE_HINT
        );
      }
    }
  }
  const feeChanged = (nextFeeRate ?? null) !== (wasOverseas ? Number(existing.overseas_fee_rate) : null);

  const amountChanged = patch.amount !== undefined;
  const currencyChanged = nextCurrency !== String(existing.currency).toUpperCase();
  // 既有匯率是壞值（歷史髒資料）時，即使這次沒改金額也要重算一次把它修回來——
  // 前端每次編輯都會重寫這兩個欄位，等於順手修復，這裡不跟上就會讓壞值永遠留著
  const existingRateIsBroken = !(Number(existing.exchange_rate) > 0);

  if (amountChanged || currencyChanged || existingRateIsBroken || feeChanged) {
    const amount = amountChanged ? parseAmount(patch.amount) : Number(existing.amount);

    const exchangeRate =
      !currencyChanged && !existingRateIsBroken
        ? Number(existing.exchange_rate)
        : await resolveExchangeRate(client, nextCurrency);

    updates.amount = amount;
    updates.currency = nextCurrency;
    updates.exchange_rate = exchangeRate;
    // 一定要帶入費率：只改金額時 nextFeeRate 就是沿用的舊費率，漏掉會把手續費弄掉
    const { overseasFee, twdAmount } = computeTwdWithFee(amount, exchangeRate, nextFeeRate);
    updates.twd_amount = twdAmount;
    updates.overseas_fee_rate = overseasFee == null ? null : nextFeeRate;
    updates.overseas_fee = overseasFee;
  }

  if (Object.keys(updates).length === 0) {
    throw smfError(ErrorCode.INVALID_INPUT, '沒有任何要修改的欄位');
  }

  const { data, error } = await client
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .select(TX_FIELDS)
    .single();

  if (error) throw fromSupabaseError(error, '修改交易');
  return { before: existing, after: data };
}

/**
 * 刪除一筆交易。
 *
 * 先讀再刪，把被刪的內容回傳出去：萬一 agent 刪錯，至少留下足以重建那筆帳的紀錄。
 * 只接受 id，不接受條件式批次刪除——那會讓「刪掉我上個月的星巴克」一次清掉十筆。
 */
export async function deleteTransaction(id) {
  const existing = await getTransaction(id);
  const client = await getAuthedClient();

  const { error } = await client.from('transactions').delete().eq('id', id);
  if (error) throw fromSupabaseError(error, '刪除交易');

  return { deleted: existing };
}
