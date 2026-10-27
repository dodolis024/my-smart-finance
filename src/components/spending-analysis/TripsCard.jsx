import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { formatTripRange } from '@/lib/trips';

const TOP_CATEGORIES = 3;

/** 幣別代碼 → 名稱（EUR → 歐元）；瀏覽器不支援就顯示代碼 */
function currencyName(code, lang) {
  try {
    return new Intl.DisplayNames([lang === 'en' ? 'en' : 'zh-TW'], { type: 'currency' }).of(code) || code;
  } catch {
    return code;
  }
}

const dayCount = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

/**
 * 旅程卡片：系統提示（連續幾天的外幣消費）＋每趟旅程的總額與主要分類。
 * 點一趟打開明細；新增與提示的「建立旅程」都交給頁面開表單。
 */
export default function TripsCard({ summaries, suggestions, currentYear, onCreate, onAcceptSuggestion, onDismissSuggestion, onSelect }) {
  const { t, lang } = useLanguage();
  const { formatTotal } = useDisplayAmount();

  return (
    <section className="analysis-card analysis-trips">
      <div className="analysis-trips__head">
        <div>
          <h3 className="analysis-card__title">{t('spendingAnalysis.trips.title')}</h3>
          <p className="analysis-card__subtitle">{t('spendingAnalysis.trips.subtitle')}</p>
        </div>
        <button type="button" className="analysis-btn" onClick={() => onCreate()}>
          {t('spendingAnalysis.trips.add')}
        </button>
      </div>

      {suggestions.map((s) => (
        <div key={s.key} className="analysis-trips__suggestion">
          <span className="analysis-trips__suggestion-text">
            {t('spendingAnalysis.trips.suggestion', {
              range: formatTripRange(s.start, s.end, currentYear),
              days: dayCount(s.start, s.end),
              count: s.count,
              currency: currencyName(s.currency, lang),
            })}
          </span>
          <button type="button" className="analysis-btn" onClick={() => onAcceptSuggestion(s)}>
            {t('spendingAnalysis.trips.suggestCreate')}
          </button>
          <button type="button" className="analysis-btn analysis-btn--quiet" onClick={() => onDismissSuggestion(s)}>
            {t('spendingAnalysis.trips.suggestDismiss')}
          </button>
        </div>
      ))}

      {summaries.length === 0 ? (
        <p className="analysis-empty">{t('spendingAnalysis.trips.empty')}</p>
      ) : (
        <ul className="analysis-trips__list">
          {summaries.map((s) => (
            <li key={s.trip.id}>
              <button type="button" className="analysis-trips__row" onClick={() => onSelect(s.trip.id)}>
                <span className="analysis-trips__name-wrap">
                  <span className="analysis-trips__name">{s.trip.name}</span>
                  <span className="analysis-trips__meta">
                    {t('spendingAnalysis.trips.meta', { range: formatTripRange(s.trip.start, s.trip.end, currentYear), count: s.count })}
                    {s.excludedCount > 0 && t('spendingAnalysis.trips.metaExcluded', { count: s.excludedCount })}
                  </span>
                </span>
                <span className="analysis-trips__cats">
                  {s.categories.slice(0, TOP_CATEGORIES).map((c) => `${c.name} ${formatTotal(c.value)}`).join(lang === 'en' ? ' · ' : '・')}
                </span>
                <span className="analysis-trips__total">{formatTotal(s.total)}</span>
                <span className="analysis-trips__chevron" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
