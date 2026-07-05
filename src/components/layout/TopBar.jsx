import { useNavigate } from 'react-router-dom';
import UserAvatar from '@/components/common/UserAvatar';
import YearReviewIcon from '@/components/yearly-review/YearReviewIcon';
import { useLanguage } from '@/contexts/LanguageContext';
import '@/styles/yearly-review.css';

export default function TopBar({ streakBadge }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  return (
    <header className="app-top-bar" aria-label={t('layout.topNav')}>
      <div className="app-top-bar__left">
        <UserAvatar variant="mobile" />
        <button
          type="button"
          className="topbar-yearly-review-btn"
          onClick={() => navigate('/yearly-review')}
          aria-label={t('yearlyReview.bannerTitle')}
          title={t('yearlyReview.bannerTitle')}
        >
          <YearReviewIcon width="20" height="20" />
        </button>
      </div>
      <div className="app-top-bar__right">
        {streakBadge}
      </div>
    </header>
  );
}
