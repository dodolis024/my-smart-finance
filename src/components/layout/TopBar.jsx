import UserAvatar from '@/components/common/UserAvatar';
import { useLanguage } from '@/contexts/LanguageContext';

export default function TopBar({ streakBadge }) {
  const { t } = useLanguage();
  return (
    <header className="app-top-bar" aria-label={t('layout.topNav')}>
      <div className="app-top-bar__left">
        <UserAvatar variant="mobile" />
      </div>
      <div className="app-top-bar__right">
        {streakBadge}
      </div>
    </header>
  );
}
