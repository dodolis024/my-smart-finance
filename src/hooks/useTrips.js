import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchTransactionsByDateRange, mapSearchRow, RANGE_FETCH_LIMIT, SELECT_COLUMNS } from '@/hooks/useTransactionSearch';
import { addMonths, daysInMonth, ymOf, FIXED_ITEM_RULE } from '@/lib/spendingAnalysis';
import { normalizeTripsSetting, fixedIdsInRange } from '@/lib/trips';

// 旅程與「不是旅程」的提示紀錄；存在 settings 跨裝置同步，不另開資料表
export const TRIPS_SETTING_KEY = 'spending_analysis_trips';

const EMPTY = { trips: [], dismissed: [] };

/** 某段日期前後各多抓幾個月：判斷固定支出要比得到其他月份 */
async function fetchAround(userId, start, end) {
  const startYm = addMonths(ymOf(start), -FIXED_ITEM_RULE.withinMonths);
  const endYm = addMonths(ymOf(end), FIXED_ITEM_RULE.withinMonths);
  const { rows, error } = await fetchTransactionsByDateRange(
    userId, `${startYm}-01`, `${endYm}-${daysInMonth(endYm)}`, { limit: RANGE_FETCH_LIMIT },
  );
  if (error) throw error;
  return rows;
}

/**
 * 消費分析頁的旅程：讀寫設定、抓每趟旅程相關的交易（日期範圍內＋手動加入的），
 * 以及建立、改日期、排除／加入交易、刪除、略過提示。計算交給 lib/trips.js。
 */
export function useTrips(userId) {
  const [setting, setSetting] = useState(EMPTY);
  const settingRef = useRef(EMPTY);
  const [settingLoaded, setSettingLoaded] = useState(false);
  const [rows, setRows] = useState([]);
  // 已經抓好哪一組範圍的交易；跟目前的 rowsKey 不同就算載入中（含設定剛讀到、還沒開始抓的那一下）
  const [loadedKey, setLoadedKey] = useState(null);
  const [error, setError] = useState(null);
  // 之後重抓失敗（不是第一次載入）：頁面照常顯示舊的交易，另外跳提示
  const [refreshError, setRefreshError] = useState(null);
  // 寫入排隊依序送出，跟大額單筆的設定同一個做法
  const saveChainRef = useRef(Promise.resolve());
  const rowsRequestRef = useRef(0);

  const loadSetting = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', TRIPS_SETTING_KEY)
      .maybeSingle();
    if (queryError) throw queryError;
    const next = normalizeTripsSetting(data?.value);
    settingRef.current = next;
    setSetting(next);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadSetting()
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setSettingLoaded(true); });
    return () => { cancelled = true; };
  }, [userId, loadSetting]);

  // 只有日期範圍或手動加入的交易變了才要重抓；排除某筆不用
  const rowsKey = useMemo(() => JSON.stringify(
    setting.trips.map((trip) => [trip.start, trip.end, [...trip.includedIds].sort()]),
  ), [setting.trips]);

  useEffect(() => {
    if (!userId || !settingLoaded) return;
    const trips = settingRef.current.trips;
    const reqId = ++rowsRequestRef.current;
    if (!trips.length) {
      setRows([]);
      setLoadedKey(rowsKey);
      return;
    }
    // 一次查完：每趟旅程的日期範圍，或是任何一趟手動加入的交易
    const clauses = trips.map((trip) => `and(date.gte.${trip.start},date.lte.${trip.end})`);
    const included = [...new Set(trips.flatMap((trip) => trip.includedIds))];
    if (included.length) clauses.push(`id.in.(${included.join(',')})`);
    supabase
      .from('transactions')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId)
      .or(clauses.join(','))
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .limit(RANGE_FETCH_LIMIT)
      .then(({ data, error: queryError }) => {
        if (reqId !== rowsRequestRef.current) return;
        if (!queryError) {
          setRows((data || []).map(mapSearchRow));
          setLoadedKey(rowsKey);
          setError(null);
          return;
        }
        // 第一次就抓不到才算載入失敗；之後重抓失敗先沿用舊的交易，下一次改動會再抓
        setLoadedKey((key) => {
          if (key === null) setError(queryError);
          else setRefreshError(queryError);
          return key;
        });
      });
  }, [userId, settingLoaded, rowsKey]);

  /**
   * 改設定：畫面先變，依序寫入；寫入失敗就從伺服器重讀一次，畫面回到實際存著的樣子。
   * update 收到「輪到它時」最新的設定，連續操作不會互相蓋掉。
   */
  const mutate = useCallback((update) => {
    if (!userId) return Promise.resolve();
    const apply = () => {
      const next = update(settingRef.current);
      settingRef.current = next;
      setSetting(next);
      return next;
    };
    apply();
    const run = saveChainRef.current.then(async () => {
      const { error: saveError } = await supabase
        .from('settings')
        .upsert({ user_id: userId, key: TRIPS_SETTING_KEY, value: settingRef.current }, { onConflict: 'user_id,key' });
      if (saveError) {
        await loadSetting().catch(() => {});
        throw saveError;
      }
    });
    saveChainRef.current = run.catch(() => {});
    return run;
  }, [userId, loadSetting]);

  const updateTrip = useCallback((tripId, change) => mutate((s) => ({
    ...s,
    trips: s.trips.map((trip) => (trip.id === tripId ? { ...trip, ...change(trip) } : trip)),
  })), [mutate]);

  /** 建立旅程：先抓前後幾個月的交易，找出範圍內的固定支出自動排除 */
  const createTrip = useCallback(async ({ name, start, end }) => {
    const around = await fetchAround(userId, start, end);
    const trip = {
      id: crypto.randomUUID(),
      name: name.trim(),
      start,
      end,
      excludedIds: [],
      fixedIds: fixedIdsInRange(around, start, end),
      keptIds: [],
      includedIds: [],
    };
    await mutate((s) => ({ ...s, trips: [...s.trips, trip] }));
    return trip;
  }, [userId, mutate]);

  /** 改名稱或日期；日期變了就重新找固定支出（使用者加回來的不再排除），手動排除與加入的照舊 */
  const editTrip = useCallback(async (tripId, { name, start, end }) => {
    const current = settingRef.current.trips.find((trip) => trip.id === tripId);
    if (!current) return;
    const datesChanged = current.start !== start || current.end !== end;
    const fixedIds = datesChanged
      ? fixedIdsInRange(await fetchAround(userId, start, end), start, end, current.keptIds)
      : current.fixedIds;
    await updateTrip(tripId, () => ({ name: name.trim(), start, end, fixedIds }));
  }, [userId, updateTrip]);

  const deleteTrip = useCallback((tripId) => mutate((s) => ({
    ...s,
    trips: s.trips.filter((trip) => trip.id !== tripId),
  })), [mutate]);

  /**
   * 明細裡的單筆操作：
   * exclude 排除、restore 加回（手動排除或自動排除的固定支出都適用）、add 加入範圍外的交易、remove 移除手動加入的
   */
  const setEntry = useCallback((tripId, txId, action) => updateTrip(tripId, (trip) => {
    const without = (list) => list.filter((id) => id !== txId);
    if (action === 'exclude') return { excludedIds: [...without(trip.excludedIds), txId] };
    if (action === 'restore') {
      // 自動排除的固定支出被加回來，記在 keptIds，改日期重新判斷時才不會又被排除
      const wasFixed = trip.fixedIds.includes(txId);
      return {
        excludedIds: without(trip.excludedIds),
        fixedIds: without(trip.fixedIds),
        keptIds: wasFixed ? [...without(trip.keptIds), txId] : trip.keptIds,
      };
    }
    if (action === 'add') return { includedIds: [...without(trip.includedIds), txId] };
    if (action === 'remove') return { includedIds: without(trip.includedIds) };
    return {};
  }), [updateTrip]);

  const dismissSuggestion = useCallback((key) => mutate((s) => ({
    ...s,
    dismissed: [...s.dismissed.filter((k) => k !== key), key],
  })), [mutate]);

  return {
    trips: setting.trips,
    dismissed: setting.dismissed,
    rows,
    // 只有第一次算載入中；之後改日期、加入交易時重抓，先沿用舊的交易，不讓整頁閃成載入中
    loading: !settingLoaded || loadedKey === null,
    error,
    refreshError,
    createTrip,
    editTrip,
    deleteTrip,
    setEntry,
    dismissSuggestion,
  };
}
