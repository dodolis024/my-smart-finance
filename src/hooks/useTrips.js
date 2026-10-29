import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getCached, setCached } from '@/lib/resourceCache';
import { mapSearchRow, RANGE_FETCH_LIMIT, SELECT_COLUMNS } from '@/hooks/useTransactionSearch';
import { normalizeTripsSetting } from '@/lib/trips';

// 旅程與「不是旅程」的提示紀錄；存在 settings 跨裝置同步，不另開資料表
export const TRIPS_SETTING_KEY = 'spending_analysis_trips';

const EMPTY = { trips: [], dismissed: [] };

// 切到別頁再回來時先用上次的設定與交易畫，背景再重抓
const SETTING_CACHE_KEY = 'spending-analysis:trips';
const ROWS_CACHE_KEY = 'spending-analysis:trip-rows';

/**
 * 消費分析頁的旅程：讀寫設定、抓每趟旅程相關的交易（日期範圍內＋手動加入的），
 * 以及建立、改日期、排除／加入交易、刪除、略過提示。計算交給 lib/trips.js。
 * 設定與交易都記在記憶體（resourceCache，登出時清掉），再回到這頁時先用記著的畫。
 */
export function useTrips(userId) {
  const [setting, setSetting] = useState(() => getCached(SETTING_CACHE_KEY, userId) ?? EMPTY);
  const settingRef = useRef(setting);
  const [settingLoaded, setSettingLoaded] = useState(() => getCached(SETTING_CACHE_KEY, userId) !== undefined);
  const [rows, setRows] = useState(() => getCached(ROWS_CACHE_KEY, userId)?.rows ?? []);
  // 已經抓好哪一組範圍的交易；跟目前的 rowsKey 不同就算載入中（含設定剛讀到、還沒開始抓的那一下）
  const [loadedKey, setLoadedKey] = useState(() => getCached(ROWS_CACHE_KEY, userId)?.key ?? null);
  const [error, setError] = useState(null);
  // 之後重抓失敗（不是第一次載入）：頁面照常顯示舊的交易，另外跳提示
  const [refreshError, setRefreshError] = useState(null);
  // 寫入排隊依序送出，跟大額單筆的設定同一個做法
  const saveChainRef = useRef(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const rowsRequestRef = useRef(0);

  const storeSetting = useCallback((next) => {
    settingRef.current = next;
    setSetting(next);
    setCached(SETTING_CACHE_KEY, userId, next);
  }, [userId]);

  const fetchSetting = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', TRIPS_SETTING_KEY)
      .maybeSingle();
    if (queryError) throw queryError;
    return normalizeTripsSetting(data?.value);
  }, [userId]);

  const loadSetting = useCallback(async () => {
    storeSetting(await fetchSetting());
  }, [fetchSetting, storeSetting]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadSetting()
      // 有記著的設定就繼續用，背景重讀失敗不把整頁換成錯誤
      .catch((err) => { if (!cancelled && getCached(SETTING_CACHE_KEY, userId) === undefined) setError(err); })
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
      setCached(ROWS_CACHE_KEY, userId, { key: rowsKey, rows: [] });
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
          const next = (data || []).map(mapSearchRow);
          setRows(next);
          setLoadedKey(rowsKey);
          setCached(ROWS_CACHE_KEY, userId, { key: rowsKey, rows: next });
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
   * 寫入前先讀雲端最新的設定，再套用這次的改動：另一個分頁或裝置剛存的不會被這邊的舊資料蓋掉。
   */
  const mutate = useCallback((update) => {
    if (!userId) return Promise.resolve();
    storeSetting(update(settingRef.current));
    pendingSavesRef.current += 1;
    const run = saveChainRef.current.then(async () => {
      try {
        const next = update(await fetchSetting());
        const { error: saveError } = await supabase
          .from('settings')
          .upsert({ user_id: userId, key: TRIPS_SETTING_KEY, value: next }, { onConflict: 'user_id,key' });
        if (saveError) throw saveError;
        // 排在後面的還沒寫完就先不換，免得畫面閃回去；最後一筆寫完再對齊雲端（含別處改的）
        if (pendingSavesRef.current === 1) storeSetting(next);
      } catch (saveError) {
        await loadSetting().catch(() => {});
        throw saveError;
      }
    }).finally(() => { pendingSavesRef.current -= 1; });
    saveChainRef.current = run.catch(() => {});
    return run;
  }, [userId, fetchSetting, loadSetting, storeSetting]);

  const updateTrip = useCallback((tripId, change) => mutate((s) => ({
    ...s,
    trips: s.trips.map((trip) => (trip.id === tripId ? { ...trip, ...change(trip) } : trip)),
  })), [mutate]);

  /** 建立旅程：日期內的支出全部算進去，要排除的由使用者在明細裡排除 */
  const createTrip = useCallback(async ({ name, start, end }) => {
    const trip = { id: crypto.randomUUID(), name: name.trim(), start, end, excludedIds: [], includedIds: [] };
    await mutate((s) => ({ ...s, trips: [...s.trips, trip] }));
    return trip;
  }, [mutate]);

  /** 改名稱或日期；手動排除與加入的照舊 */
  const editTrip = useCallback(async (tripId, { name, start, end }) => {
    await updateTrip(tripId, () => ({ name: name.trim(), start, end }));
  }, [updateTrip]);

  const deleteTrip = useCallback((tripId) => mutate((s) => ({
    ...s,
    trips: s.trips.filter((trip) => trip.id !== tripId),
  })), [mutate]);

  /**
   * 明細裡的單筆操作：
   * exclude 排除、restore 加回、add 加入範圍外的交易、remove 移除手動加入的
   */
  const setEntry = useCallback((tripId, txId, action) => updateTrip(tripId, (trip) => {
    const without = (list) => list.filter((id) => id !== txId);
    if (action === 'exclude') return { excludedIds: [...without(trip.excludedIds), txId] };
    if (action === 'restore') return { excludedIds: without(trip.excludedIds) };
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
