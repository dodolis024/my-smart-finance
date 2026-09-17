import { useLanguage } from '@/contexts/LanguageContext';

export default function StoryProgressBar({ total, current, onJump }) {
  const { t } = useLanguage();
  return (
    <div className="story-progress-bar" role="tablist" aria-label={t('yearlyReview.cardProgress')}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          role="tab"
          aria-selected={i === current}
          className={[
            'story-progress-bar__segment',
            i < current  ? 'story-progress-bar__segment--passed' : '',
            i === current ? 'story-progress-bar__segment--active' : '',
          ].join(' ')}
          onClick={() => onJump(i)}
        />
      ))}
    </div>
  );
}
