import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getTodayYmd } from '@/lib/utils';
import { STREAK_MILESTONES } from '@/lib/constants';
import { useLanguage } from '@/contexts/LanguageContext';

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

  /**
   * 判斷本次是否該跳「用掉凍結卡」的簡單提示：本次有消耗、使用者曾獲得過卡，
   * 且今天 localStorage 尚未顯示過（比照 shouldShowBrokenModal 的去重寫法）。
   * @param {{ earnedTotal?: number, consumedThisCall?: number }} [data]
   */
  const shouldShowFreezeConsumedToast = useCallback((data) => {
    const earnedTotal = data?.earnedTotal ?? 0;
    const consumedThisCall = data?.consumedThisCall ?? 0;
    if (earnedTotal <= 0 || consumedThisCall <= 0) return false;

    const today = getTodayYmd();
    const key = userId ? `streakFreezeConsumedShownDate:${userId}` : 'streakFreezeConsumedShownDate';
    try {
      const shownFor = window.localStorage.getItem(key);
      if (shownFor === today) return false;
      window.localStorage.setItem(key, today);
      return true;
    } catch {
      return true;
    }
  }, [userId]);

  /**
   * @param {boolean} [brokenFromServer]
   */
  const shouldShowBrokenModal = useCallback((brokenFromServer) => {
    const broken = brokenFromServer ?? streakState.broken;
    if (!broken) return false;
    const today = getTodayYmd();
    const key = userId ? `streakBrokenShownDate:${userId}` : 'streakBrokenShownDate';
    try {
      const shownFor = window.localStorage.getItem(key);
      if (shownFor === today) return false;
      window.localStorage.setItem(key, today);
      return true;
    } catch {
      return true;
    }
  }, [streakState.broken, userId]);

  const shouldShowPositiveModal = useCallback(
    (submittedDate) => {
      const today = getTodayYmd();
      if (!submittedDate || submittedDate !== today) return false;
      if (streakState.broken) return false;
      if (!streakState.count || streakState.count <= 0) return false;

      const key = userId ? `streakPositiveShownDate:${userId}` : 'streakPositiveShownDate';
      try {
        const shownFor = window.localStorage.getItem(key);
        if (shownFor === today) return false;
        window.localStorage.setItem(key, today);
        return true;
      } catch {
        return true;
      }
    },
    [streakState.broken, streakState.count, userId]
  );

  const getPositiveModalContent = useCallback(() => {
    const count = streakState.count || 0;
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
