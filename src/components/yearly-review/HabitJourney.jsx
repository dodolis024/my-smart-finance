import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

// Membership days as-of the reviewed year's last day — so a past year's review
// reflects that year, not "today". Returns null if the user joined after it.
function membershipDaysAsOf(createdAt, year) {
  if (!createdAt) return null;
  const c = new Date(createdAt);
  const created = new Date(c.getFullYear(), c.getMonth(), c.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearEnd = new Date(year, 11, 31);
  const asOf = today < yearEnd ? today : yearEnd;
  if (asOf < created) return null;
  return Math.round((asOf - created) / 86400000) + 1;
}

export default function HabitJourney({ year, checkinDays = 0, transactionCount = 0, previousCount = 0, loading }) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const locale = lang === 'en' ? 'en-US' : 'zh-TW';

  const memberDays = membershipDaysAsOf(user?.created_at, year);

  // Only celebrate an increase — if last year had no data or fewer entries,
  // we simply omit the line rather than framing it as a shortfall.
  const entriesGain = previousCount > 0 ? transactionCount - previousCount : 0;

  const encouragement = checkinDays >= 200
    ? t('yearlyReview.habit.encourageHigh')
    : checkinDays >= 60
    ? t('yearlyReview.habit.encourageMid')
    : t('yearlyReview.habit.encourageLow');

  if (loading) {
    return (
      <div className="review-card review-card--habit">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  return (
    <div className="review-card review-card--habit">
      <p className="review-card__eyebrow">{t('yearlyReview.habit.title')}</p>

      <div className="review-checkin-circle">
        <span className="review-checkin-circle__number">{checkinDays.toLocaleString(locale)}</span>
        <span className="review-checkin-circle__unit">{t('yearlyReview.habit.checkinLabel')}</span>
      </div>

      <div className="review-habit-stats">
        {memberDays != null && (
          <div className="review-habit-stat">
            <span className="review-habit-stat__value">{memberDays.toLocaleString(locale)}</span>
            <span className="review-habit-stat__label">{t('yearlyReview.habit.memberLabel')}</span>
          </div>
        )}
        <div className="review-habit-stat">
          <span className="review-habit-stat__value">{transactionCount.toLocaleString(locale)}</span>
          <span className="review-habit-stat__label">{t('yearlyReview.habit.entriesLabel')}</span>
          {entriesGain > 0 && (
            <span className="review-delta review-delta--good">
              {t('yearlyReview.compare.entriesMore', { count: entriesGain.toLocaleString(locale) })}
            </span>
          )}
        </div>
      </div>

      <p className="review-encourage">{encouragement}</p>
    </div>
  );
}
