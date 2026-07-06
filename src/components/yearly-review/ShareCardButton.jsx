import { useLanguage } from '@/contexts/LanguageContext';

export default function ShareCardButton({ exporting, onClick }) {
  const { t } = useLanguage();
  return (
    <button
      className="yearly-review__share"
      onClick={onClick}
      disabled={exporting}
      aria-label={t('yearlyReview.shareCard')}
      title={t('yearlyReview.shareCard')}
    >
      {exporting ? (
        <span className="yearly-review__share-spinner" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v13M7 8l5-5 5 5" />
          <path d="M5 17v2a1 1 0 001 1h12a1 1 0 001-1v-2" />
        </svg>
      )}
    </button>
  );
}
