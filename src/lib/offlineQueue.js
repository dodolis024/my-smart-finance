// 離線記帳佇列:斷網時把「已解析完成」的交易 insert payload 暫存 localStorage,
// 恢復連線後重放。冪等性靠客戶端產生的 UUID(transactions.id 為 UUID PK):
// 重試撞到 Postgres 23505 重複鍵一律視為已成功,避免重複記帳。
import { supabase } from '@/lib/supabase';
import { isOfflineError } from '@/lib/offlineCache';

const QUEUE_PREFIX = 'sf:txq:v1';

const listeners = new Set();
function notify() {
  listeners.forEach((l) => l());
}

// 佇列變動時通知 UI(待同步徽章/列表)重新讀取
export function subscribeQueue(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function queueKey(userId) {
  return `${QUEUE_PREFIX}:${userId}`;
}

export function listQueue(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(queueKey(userId));
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// 回傳是否寫入成功;quota 滿或隱私模式下 setItem 會拋錯 → false
function writeQueue(userId, items) {
  try {
    if (items.length === 0) {
      localStorage.removeItem(queueKey(userId));
    } else {
      localStorage.setItem(queueKey(userId), JSON.stringify(items));
    }
  } catch {
    return false;
  }
  notify();
  return true;
}

/**
 * 將完整的 transactions insert payload(含客戶端 UUID id)入列。
 * 回傳是否入列成功——localStorage 額滿時會失敗,呼叫端必須據此告知使用者,
 * 否則交易會在「看似已暫存」的狀態下無聲遺失。
 * @param {string} enqueuedOn 入列當天(local YYYY-MM-DD),flush 時據此補簽到
 */
export function enqueueTransaction(userId, tx, enqueuedOn) {
  const items = listQueue(userId);
  items.push({
    id: tx.id,
    enqueuedOn,
    enqueuedAt: Date.now(),
    status: 'pending',
    errorMessage: null,
    tx,
  });
  return writeQueue(userId, items);
}

export function removeQueued(userId, id) {
  const items = listQueue(userId).filter((item) => item.id !== id);
  writeQueue(userId, items);
}

// single-flight:'online' 事件與頁面掛載可能同時觸發 flush,共用同一個進行中的 Promise
let flushPromise = null;

export function flushQueue(userId, { includeFailed = false } = {}) {
  if (flushPromise) return flushPromise;
  flushPromise = doFlush(userId, includeFailed).finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

async function doFlush(userId, includeFailed) {
  const result = { synced: 0, failed: 0, needsLogin: false, offline: false };
  const targets = listQueue(userId).filter(
    (item) => item.status === 'pending' || (includeFailed && item.status === 'failed')
  );
  if (targets.length === 0) return result;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    result.offline = true;
    return result;
  }

  // session 失效(refresh token 過期)時保留整個佇列,絕不丟資料
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    result.needsLogin = true;
    return result;
  }

  const syncedIds = new Set();
  const failedById = new Map();

  for (const item of targets) {
    try {
      const tx = { ...item.tx };

      // 入列時取不到匯率的項目,補送前先解析(見 useTransactions 離線路徑)
      if (tx.exchange_rate == null) {
        const { data: rate, error: rateErr } = await supabase.rpc('get_exchange_rate', {
          p_currency: tx.currency,
        });
        if (rateErr || rate == null || Number(rate) <= 0) {
          const err = new Error(rateErr?.message || `no exchange rate for ${tx.currency}`);
          if (rateErr && isOfflineError(rateErr)) err.__offline = true;
          throw err;
        }
        tx.exchange_rate = Number(rate);
        tx.twd_amount = Math.round(tx.amount * tx.exchange_rate * 100) / 100;
      }

      const { error } = await supabase.from('transactions').insert(tx);
      // 23505 = 此 UUID 已寫入過(上次重試已成功),視為同步完成
      if (error && error.code !== '23505') {
        const err = new Error(error.message || 'insert failed');
        err.code = error.code;
        throw err;
      }

      // 入列當天記的帳,streak 簽到記在入列日(非補送日);upsert 天然冪等
      if (tx.date === item.enqueuedOn) {
        await supabase
          .from('checkins')
          .upsert(
            { user_id: userId, date: item.enqueuedOn, source: 'onTimeTransaction' },
            { onConflict: 'user_id,date' }
          );
        // 簽到失敗不影響交易同步結果,忽略
      }

      syncedIds.add(item.id);
      result.synced += 1;
    } catch (err) {
      if (err?.__offline || isOfflineError(err)) {
        // 中途又斷網:剩餘項目原封保留,等下次觸發
        result.offline = true;
        break;
      }
      failedById.set(item.id, err?.message || String(err));
      result.failed += 1;
    }
  }

  // 以最新佇列為準套用結果(flush 期間可能有新項目入列)
  const remaining = listQueue(userId)
    .filter((item) => !syncedIds.has(item.id))
    .map((item) =>
      failedById.has(item.id)
        ? { ...item, status: 'failed', errorMessage: failedById.get(item.id) }
        : item
    );
  writeQueue(userId, remaining);

  return result;
}
