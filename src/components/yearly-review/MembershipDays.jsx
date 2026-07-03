import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

function daysSince(createdAt) {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  const start = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - start) / 86400000) + 1;
}

export default function MembershipDays({ loading }) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();

  const days = daysSince(user?.created_at);

  if (loading) {
    return (
      <div className="review-card review-card--membership">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  if (days == null) {
    return (
      <div className="review-card review-card--membership">
        <p className="review-card__title">{t('yearlyReview.membership.title')}</p>
        <p className="review-card__empty">{t('yearlyReview.noData')}</p>
      </div>
    );
  }

  const joinedDate = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(user.created_at));

  return (
    <div className="review-card review-card--membership">
      <p className="review-card__eyebrow">{t('yearlyReview.membership.title')}</p>

      <div className="review-membership-stat">
        <span className="review-big-number">{days.toLocaleString(lang === 'en' ? 'en-US' : 'zh-TW')}</span>
        <span className="review-membership-stat__unit">{t('yearlyReview.membership.daysLabel')}</span>
      </div>

      <p className="review-card__subtitle">
        {t('yearlyReview.membership.subtitle', { date: joinedDate })}
      </p>
    </div>
  );
}
