import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

/** 自動抓出的大額單筆；每筆可以改成「算進分析」，再按一次改回另外列 */
export default function LargeItemsList({ items, onToggle }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();

  return (
    <section className="analysis-card analysis-large">
      <h3 className="analysis-card__title">{t('spendingAnalysis.large.title')}</h3>
      <p className="analysis-card__subtitle">{t('spendingAnalysis.large.subtitle')}</p>
      <ul className="analysis-large__list">
        {items.map(({ tx, included, value }) => {
          const [, m, d] = tx.date.split('-').map(Number);
          return (
            <li key={tx.id} className={`analysis-large__row${included ? ' is-included' : ''}`}>
              <span className="analysis-large__date">{m}/{d}</span>
              <span className="analysis-large__name">
                {[tx.category, tx.itemName].filter(Boolean).join('・')}
              </span>
              <span className="analysis-large__amount">{formatTotal(value)}</span>
              {included && <span className="analysis-large__state">{t('spendingAnalysis.large.included')}</span>}
              <button type="button" className="analysis-large__toggle" onClick={() => onToggle(tx.id, !included)}>
                {included ? t('spendingAnalysis.large.exclude') : t('spendingAnalysis.large.include')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
