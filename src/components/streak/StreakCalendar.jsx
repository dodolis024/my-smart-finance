import { useState, useMemo } from 'react';
import { getTodayYmd } from '@/lib/utils';
import { useTheme } from '../../hooks/useTheme.js';
import { useLanguage } from '@/contexts/LanguageContext';
import zhLocale from '@/locales/zh';
import enLocale from '@/locales/en';

export default function StreakCalendar({ streakState }) {
  const { theme } = useTheme();
  const { t, lang } = useLanguage();
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth() + 1);

  const loggedBySource = useMemo(() => {
    const onTime = new Set();
    const manual = new Set();
    (streakState?.loggedDatesWithSource || streakState?.loggedDates || []).forEach((item) => {
      const dateStr = typeof item === 'string' ? item : item?.date;
      if (!dateStr) return;
      const src = typeof item === 'object' && item && 'source' in item ? String(item.source) : '';
      if (src === 'onTimeTransaction') onTime.add(dateStr);
      else manual.add(dateStr);
    });
    return { onTime, manual };
  }, [streakState]);

  const navigate = (dir) => {
    const next = new Date(calYear, calMonth - 1 + dir, 1);
    setCalYear(next.getFullYear());
    setCalMonth(next.getMonth() + 1);
  };

  const firstWeekday = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const todayStr = getTodayYmd();

  const days = [];
  for (let i = 0; i < firstWeekday; i++) {
    days.push({ empty: true, key: `empty-${i}` });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(calMonth).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const dateStr = `${calYear}-${mm}-${dd}`;
    const isTransaction = loggedBySource.onTime.has(dateStr);
    const isManual = loggedBySource.manual.has(dateStr);
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;
    days.push({ d, dateStr, isTransaction: !isFuture && isTransaction, isManual: !isFuture && isManual, isToday });
  }

  const count = streakState?.count || 0;
  const total = streakState?.totalDays || 0;
  const longest = streakState?.longestStreak || 0;
  const weekLabels = (lang === 'en' ? enLocale : zhLocale).streak.weekLabels;

  return (
    <div className="streak-calendar-root">
      <div className="streak-calendar">
        <div className="streak-calendar__header">
          <button type="button" className="streak-calendar__nav-btn" aria-label={t('streak.prevMonth')} onClick={(e) => { navigate(-1); e.currentTarget.blur(); }}>‹</button>
          <div className="streak-calendar__month">{t('streak.calendarMonthLabel', { year: calYear, month: calMonth, monthName: new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-TW', { month: 'long' }).format(new Date(calYear, calMonth - 1, 1)) })}</div>
          <button type="button" className="streak-calendar__nav-btn" aria-label={t('streak.nextMonth')} onClick={(e) => { navigate(1); e.currentTarget.blur(); }}>›</button>
        </div>
        <div className="streak-calendar__weekdays">
          {weekLabels.map((w, i) => (
            <div key={i} className="streak-calendar__weekday">{w}</div>
          ))}
        </div>
        <div className="streak-calendar__grid">
          {days.map((day) => {
            if (day.empty) {
              return <div key={day.key} className="streak-calendar__day streak-calendar__day--empty"><div className="streak-calendar__day-inner" /></div>;
            }
            let cls = 'streak-calendar__day';
            if (day.isTransaction) cls += ' streak-calendar__day--transaction';
            else if (day.isManual) cls += ' streak-calendar__day--manual';
            if (day.isToday) cls += ' streak-calendar__day--today';
            return (
              <div key={day.dateStr} className={cls}>
                <div className="streak-calendar__day-inner">{day.d}</div>
              </div>
            );
          })}
        </div>
        <div className="streak-calendar__legend">
          <span className="streak-calendar__legend-item streak-calendar__legend-item--transaction">{t('streak.legendTransaction')}</span>
          <span className="streak-calendar__legend-item streak-calendar__legend-item--manual">{t('streak.legendCheckin')}</span>
        </div>
      </div>
      <div className="streak-summary">
        <div className="streak-summary__card">
          <div className="streak-summary__label">{t('streak.currentStreak')}</div>
          <div className="streak-summary__value">
            <span className="streak-summary__value-emoji">
              {count > 0 && (theme === 'dawn' ? (
                <svg className="icon-diamond" aria-hidden="true" width="18" height="18">
                  <use href="#icon-diamond" />
                </svg>
              ) : (
                <svg className="icon-fire" aria-hidden="true" width="18" height="18">
                  <use href="#icon-fire" />
                </svg>
              ))}
            </span>
            <span className="streak-summary__value-number">{count}</span><span>{t('streak.unit')}</span>
          </div>
        </div>
        <div className="streak-summary__card">
          <div className="streak-summary__label">{t('streak.totalDays')}</div>
          <div className="streak-summary__value">
            <span className="streak-summary__value-number">{total}</span><span>{t('streak.unit')}</span>
          </div>
        </div>
        <div className="streak-summary__card">
          <div className="streak-summary__label">{t('streak.longestStreak')}</div>
          <div className="streak-summary__value">
            <span className="streak-summary__value-number">{longest}</span><span>{t('streak.unit')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
