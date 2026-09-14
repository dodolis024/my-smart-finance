import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getTodayYmd } from '@/lib/utils';
import { STREAK_MILESTONES } from '@/lib/constants';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 每日提醒（連續紀錄彈窗 / 凍結卡提示）的「今天已顯示過」記號。
 *
 * 記號同時寫在兩個地方：
 * - localStorage：本機快取，讓最常見的「同一台裝置今天已看過」不必等網路。
 * - Supabase settings 表：跨裝置的事實來源，讓電腦看過之後手機不再重跳。
 *
 * 讀不到伺服器（離線、請求失敗）時退回只看本機，寧可重複顯示一次也不要整個消失。
 */
const NOTICE_SETTINGS_KEY = 'streak_notices';

const NOTICE_LOCAL_KEYS = {
  positive: 'streakPositiveShownDate',
  broken: 'streakBrokenShownDate',
  freezeConsumed: 'streakFreezeConsumedShownDate',
};

function readLocalNotice(kind, userId) {
  const base = NOTICE_LOCAL_KEYS[kind];
  const key = userId ? `${base}:${userId}` : base;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalNotice(kind, userId, date) {
  const base = NOTICE_LOCAL_KEYS[kind];
  const key = userId ? `${base}:${userId}` : base;
  try {
    window.localStorage.setItem(key, date);
  } catch {
    // 私密模式 / 配額用盡：伺服器那份仍會寫入，只是本機少一層快取
  }
}

export function useStreak(userId) {
  const { t } = useLanguage();
  const [streakState, setStreakState] = useState({
    count: 0,
    broken: false,
    totalDays: 0,
    longestStreak: 0,
    loggedDates: [],
    loggedDatesWithSource: [],
  });
  const [streakInitialHandled, setStreakInitialHandled] = useState(false);
  // 凍結卡庫存狀態：balance/earnedTotal 皆來自 reconcile_streak_freezes 的回傳，
  // earnedTotal>0 是 UI 是否顯示任何 frozen 相關內容的總開關
  const [freezeState, setFreezeState] = useState({
    balance: 0,
    earnedTotal: 0,
  });

  const updateStreakFromServer = useCallback((data) => {
    const count = data?.streakCount ?? 0;
    const broken = !!data?.streakBroken;
    const totalDays = data?.totalLoggedDays ?? 0;
    const longestStreak = data?.longestStreak ?? 0;
    const rawLogged = Array.isArray(data?.loggedDates) ? data.loggedDates.slice() : [];
    const loggedDates = rawLogged.map((d) => (typeof d === 'string' ? d : d.date));

    setStreakState({
      count,
      broken,
      totalDays,
      longestStreak,
      loggedDates,
      loggedDatesWithSource: rawLogged,
    });
  }, []);

  const hasCheckinToday = useCallback(() => {
    const today = getTodayYmd();
    return streakState.loggedDates.includes(today);
  }, [streakState.loggedDates]);

  const submitDailyCheckin = useCallback(async () => {
    const today = getTodayYmd();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error(t('auth.loginRequired'));

    const { error } = await supabase.from('checkins').upsert(
      { user_id: user.id, date: today, source: 'manual' },
      { onConflict: 'user_id,date' }
    );

    if (error) throw error;
  }, [t]);

  /**
   * 開 App 對帳：呼叫 reconcile_streak_freezes 完成「補橋接 + 發卡」，
   * 並把回傳的凍結卡庫存狀態存進 state。回傳完整 data 供呼叫端判斷是否要跳消耗提示。
   */
  const reconcileStreakFreezes = useCallback(async () => {
    const { data, error } = await supabase.rpc('reconcile_streak_freezes', {
      p_client_today: getTodayYmd(),
    });
    if (error) throw error;
    if (data?.success) {
      setFreezeState({
        balance: data.balance ?? 0,
        earnedTotal: data.earnedTotal ?? 0,
      });
    }
    return data;
  }, []);

  // 本次 session 已認領的記號，寫回伺服器時一併帶上，
  // 避免同時認領的兩個提醒互相覆蓋彼此的日期。
  const claimedNoticesRef = useRef({});
  // 同一輪多個提醒同時判斷時共用一次讀取
  const noticesInflightRef = useRef(null);

  const loadRemoteNotices = useCallback(async () => {
    if (!userId) return null;
    if (noticesInflightRef.current) return noticesInflightRef.current;

    const request = (async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', NOTICE_SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      return data?.value ?? {};
    })();

    noticesInflightRef.current = request;
    try {
      return await request;
    } finally {
      noticesInflightRef.current = null;
    }
  }, [userId]);

  /**
   * 認領某個提醒的「今天」：回傳 true 代表這次該顯示，同時把記號寫進本機與伺服器。
   *
   * 先看本機（命中就不必等網路），本機沒有才問伺服器另一台裝置是否已顯示過。
   * 伺服器讀不到就當作沒顯示過——離線時寧可重複跳一次，也不要整個不跳。
   *
   * @param {'positive'|'broken'|'freezeConsumed'} kind
   */
  const claimNoticeForToday = useCallback(
    async (kind) => {
      const today = getTodayYmd();
      if (readLocalNotice(kind, userId) === today) return false;

      let remote = null;
      try {
        remote = await loadRemoteNotices();
      } catch (err) {
        console.error('[useStreak] load notice flags failed:', err);
      }

      writeLocalNotice(kind, userId, today);
      if (remote?.[kind] === today) return false;

      claimedNoticesRef.current = { ...claimedNoticesRef.current, [kind]: today };
      if (userId) {
        const value = { ...(remote ?? {}), ...claimedNoticesRef.current };
        supabase
          .from('settings')
          .upsert({ user_id: userId, key: NOTICE_SETTINGS_KEY, value }, { onConflict: 'user_id,key' })
          .then(({ error }) => {
            if (error) console.error('[useStreak] persist notice flag failed:', error);
          });
      }
      return true;
    },
    [userId, loadRemoteNotices]
  );

  /**
   * 判斷本次是否該跳「用掉凍結卡」的簡單提示：本次有消耗、使用者曾獲得過卡，且今天尚未顯示過。
   * @param {{ earnedTotal?: number, consumedThisCall?: number }} [data]
   */
  const shouldShowFreezeConsumedToast = useCallback(
    async (data) => {
      const earnedTotal = data?.earnedTotal ?? 0;
      const consumedThisCall = data?.consumedThisCall ?? 0;
      if (earnedTotal <= 0 || consumedThisCall <= 0) return false;
      return claimNoticeForToday('freezeConsumed');
    },
    [claimNoticeForToday]
  );

  /**
   * @param {boolean} [brokenFromServer]
   */
  const shouldShowBrokenModal = useCallback(
    async (brokenFromServer) => {
      const broken = brokenFromServer ?? streakState.broken;
      if (!broken) return false;
      return claimNoticeForToday('broken');
    },
    [streakState.broken, claimNoticeForToday]
  );

  /**
   * @param {string} submittedDate
   * @param {{ streakCount?: number, streakBroken?: boolean } | null} [data]
   *   記帳後重抓回來的伺服器資料；送出前的 state 還沒算進這筆的簽到，
   *   昨天中斷、今天記第一筆時仍是「中斷」。拿不到才退回 state。
   */
  const shouldShowPositiveModal = useCallback(
    async (submittedDate, data) => {
      const today = getTodayYmd();
      if (!submittedDate || submittedDate !== today) return false;
      const broken = data ? !!data.streakBroken : streakState.broken;
      const count = data ? data.streakCount ?? 0 : streakState.count;
      if (broken) return false;
      if (!count || count <= 0) return false;
      return claimNoticeForToday('positive');
    },
    [streakState.broken, streakState.count, claimNoticeForToday]
  );

  /** @param {number} [countFromServer] 同上，傳入重抓後的天數，里程碑標題才不會晚一天 */
  const getPositiveModalContent = useCallback((countFromServer) => {
    const count = countFromServer ?? streakState.count ?? 0;
    if (STREAK_MILESTONES.includes(count)) {
      return {
        title: t('streak.milestoneTitle'),
        text: t('streak.milestoneText', { count }),
      };
    }
    return {
      title: t('streak.regularTitle'),
      text: t('streak.regularText', { count }),
    };
  }, [streakState.count, t]);

  const getCurrentModalContent = useCallback(() => {
    const count = streakState.count || 0;
    if (streakState.broken) {
      return {
        title: t('streak.neutralBrokenTitle'),
        text: t('streak.neutralBrokenText'),
        buttonLabel: t('streak.neutralBrokenBtn'),
        variant: 'neutral',
      };
    }
    if (count > 0) {
      return {
        title: t('streak.neutralActiveTitle', { count }),
        text: t('streak.neutralActiveText', { count }),
        buttonLabel: t('streak.neutralActiveBtn'),
        variant: 'neutral',
      };
    }
    return {
      title: t('streak.neutralNoneTitle'),
      text: t('streak.neutralNoneText'),
      buttonLabel: 'Go Go!',
      variant: 'neutral',
    };
  }, [streakState.broken, streakState.count, t]);

  /** Compute modal content from raw server data to avoid React state race conditions */
  const getCurrentModalContentFromData = useCallback((data) => {
    const count = data?.streakCount ?? 0;
    const broken = !!data?.streakBroken;
    if (broken) {
      return {
        title: t('streak.neutralBrokenTitle'),
        text: t('streak.neutralBrokenText'),
        buttonLabel: t('streak.neutralBrokenBtn'),
        variant: 'neutral',
      };
    }
    if (count > 0) {
      return {
        title: t('streak.neutralActiveTitle', { count }),
        text: t('streak.neutralActiveText', { count }),
        buttonLabel: t('streak.neutralActiveBtn'),
        variant: 'neutral',
      };
    }
    return {
      title: t('streak.neutralNoneTitle'),
      text: t('streak.neutralNoneText'),
      buttonLabel: 'Go Go!',
      variant: 'neutral',
    };
  }, [t]);

  return {
    streakState,
    streakInitialHandled,
    setStreakInitialHandled,
    updateStreakFromServer,
    hasCheckinToday,
    submitDailyCheckin,
    shouldShowBrokenModal,
    shouldShowPositiveModal,
    getPositiveModalContent,
    getCurrentModalContent,
    getCurrentModalContentFromData,
    freezeState,
    reconcileStreakFreezes,
    shouldShowFreezeConsumedToast,
  };
}
