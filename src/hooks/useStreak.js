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
  };
}
