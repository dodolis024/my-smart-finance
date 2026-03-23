import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getTodayYmd } from '@/lib/utils';
import { STREAK_MILESTONES } from '@/lib/constants';

export function useStreak(userId) {
  const [streakState, setStreakState] = useState({
    count: 0,
    broken: false,
    totalDays: 0,
    longestStreak: 0,
    loggedDates: [],
    loggedDatesWithSource: [],
  });
  const [streakInitialHandled, setStreakInitialHandled] = useState(false);

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
    if (!user) throw new Error('請先登入');

    const { error } = await supabase.from('checkins').upsert(
      { user_id: user.id, date: today, source: 'manual' },
      { onConflict: 'user_id,date' }
    );

    if (error) throw error;
  }, []);

  /**
   * @param {boolean} [brokenFromServer] - 若傳入，優先使用此值（來自 dashboardData），避免 React 狀態尚未更新時的競態問題
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
        title: '里程碑達成！',
        text: `你已經連續記帳 ${count} 天了！真棒真棒🥹`,
      };
    }
    return {
      title: '怎麼這麼乖呀！',
      text: `今天是記帳的第 ${count} 天，明天也要繼續保持呦☺️`,
    };
  }, [streakState.count]);

  const getCurrentModalContent = useCallback(() => {
    const count = streakState.count || 0;
    if (streakState.broken) {
      return {
        title: '目前連續記帳：0 天',
        text: '目前沒有連續紀錄，今天要重新開始咪～～',
        buttonLabel: '好鴨',
        variant: 'neutral',
      };
    }
    if (count > 0) {
      return {
        title: `目前連續記帳：${count} 天`,
        text: `太厲害了！已經連續記錄 ${count} 天，繼續往下一個里程碑前進吧！🔥`,
        buttonLabel: '好的',
        variant: 'neutral',
      };
    }
    return {
      title: '還沒有連續紀錄',
      text: '從今天開始記第一筆，就會開始累積你的連續紀錄！',
      buttonLabel: 'Go Go!',
      variant: 'neutral',
    };
  }, [streakState.broken, streakState.count]);

  /** 從 API 回傳的原始資料計算 modal 內容，避免 React 狀態尚未更新時的競態問題 */
  const getCurrentModalContentFromData = useCallback((data) => {
    const count = data?.streakCount ?? 0;
    const broken = !!data?.streakBroken;
    if (broken) {
      return {
        title: '目前連續記帳：0 天',
        text: '目前沒有連續紀錄，今天要重新開始咪～～',
        buttonLabel: '好鴨',
        variant: 'neutral',
      };
    }
    if (count > 0) {
      return {
        title: `目前連續記帳：${count} 天`,
        text: `太厲害了！已經連續記錄 ${count} 天，繼續往下一個里程碑前進吧！🔥`,
        buttonLabel: '好的',
        variant: 'neutral',
      };
    }
    return {
      title: '還沒有連續紀錄',
      text: '從今天開始記第一筆，就會開始累積你的連續紀錄！',
      buttonLabel: 'Go Go!',
      variant: 'neutral',
    };
  }, []);

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
  };
}
