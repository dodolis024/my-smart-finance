import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { loadRates } from '@/lib/offlineCache';

// 顯示幣別的匯率表：{ history: [[date, rate], ...依日期升冪], live: 今日匯率 }。
// 歷史匯率每天只多一列、全站共用（非個資），所以：
//   - 模組層級快取：同一次頁面載入內切來切去不重抓
//   - localStorage：重新整理或離線時首屏就能換算，背景再抓最新的
const LOCAL_PREFIX = 'sf:rate-history:v1';
// PostgREST 單次最多回 1000 列（Supabase 預設），歷史累積超過就要分頁抓
const PAGE_SIZE = 1000;

const memory = new Map(); // currency -> table
const inflight = new Map(); // currency -> Promise<table>

function readLocal(currency) {
  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}:${currency}`);
    const table = raw ? JSON.parse(raw) : null;
    return table && Array.isArray(table.history) ? table : null;
  } catch {
    return null;
  }
}

function writeLocal(currency, table) {
  try {
    localStorage.setItem(`${LOCAL_PREFIX}:${currency}`, JSON.stringify(table));
  } catch {
    // quota 滿或隱私模式：只是少了離線／首屏快取
  }
}

async function fetchRateTable(currency) {
  const history = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('exchange_rate_history')
      .select('date, rate')
      .eq('currency_code', currency)
      .order('date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data || []) {
      const rate = Number(row.rate);
      if (rate > 0) history.push([row.date, rate]);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }

  const { data: liveRow } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('currency_code', currency)
    .maybeSingle();
  const live = Number(liveRow?.rate) > 0 ? Number(liveRow.rate) : Number(loadRates()?.[currency]) || null;

  return { history, live };
}

function loadRateTable(currency) {
  if (!inflight.has(currency)) {
    const p = fetchRateTable(currency)
      .then((table) => {
        memory.set(currency, table);
        writeLocal(currency, table);
        return table;
      })
      .finally(() => inflight.delete(currency));
    inflight.set(currency, p);
  }
  return inflight.get(currency);
}

const cachedTable = (currency) => memory.get(currency) || readLocal(currency) || null;

/** 回傳顯示幣別的匯率表；台幣不需要換算回 null，尚未載入也回 null */
export function useDisplayRates(currency) {
  const needsRates = Boolean(currency) && currency !== 'TWD';
  const [state, setState] = useState(() => ({ currency, table: needsRates ? cachedTable(currency) : null }));

  // 幣別一換就先換成該幣別的快取（render 期同步，免得短暫拿舊幣別的表去算）
  if (state.currency !== currency) {
    setState({ currency, table: needsRates ? cachedTable(currency) : null });
  }

  useEffect(() => {
    if (!needsRates) return undefined;
    let cancelled = false;
    // 每次頁面載入各幣別抓一次（memory 命中就不抓）；失敗就沿用快取
    if (!memory.has(currency)) {
      loadRateTable(currency)
        .then((table) => { if (!cancelled) setState({ currency, table }); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [currency, needsRates]);

  return state.currency === currency ? state.table : null;
}
