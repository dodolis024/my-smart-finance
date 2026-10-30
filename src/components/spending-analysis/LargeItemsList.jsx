import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { formatOriginalMoney } from '@/lib/utils';
import InfoTip from '@/components/spending-analysis/InfoTip';
import EntryButton from '@/components/spending-analysis/EntryButton';

/** 門檻金額：整數就不印小數（£250、$10,000） */
const formatAmount = ({ amount, currency }) =>
  formatOriginalMoney(amount, currency, { wholeUnits: Number.isInteger(amount) });

/**
 * 正在看的這個月的大額消費：只列出來，金額照樣算在上面的分析裡。門檻在頁面右上角的設定改。
 * 每一筆可以按 ⊖ 排除（整頁都不算它），排除的留在原位變淡，按 ⊕ 放回來。
 *
 * @param {{ tx: object, value: number, excluded: boolean }[]} items
 * @param {{ amount: number, currency: string }} threshold 使用者存的門檻（判斷一律照它）
 * @param {{ amount: number, currency: string, approx: boolean } | null} shown 門檻在顯示幣別下怎麼寫（thresholdForDisplay）
 * @param {(txId: string, exclude: boolean) => void} onToggleExcluded
 */
export default function LargeItemsList({ items, threshold, shown, onToggleExcluded }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  const thresholdText = formatAmount(threshold);
  // 換算出來的數字前面加「約」，小 i 補一句是從哪個金額換算的
  const shownText = !shown ? thresholdText : shown.approx
    ? t('spendingAnalysis.large.approx', { amount: formatAmount(shown) })
    : formatAmount(shown);

  return (
    <section className="analysis-card analysis-large">
      <h3 className="analysis-card__title">
        {t('spendingAnalysis.large.title')}
        <InfoTip>
          {t('spendingAnalysis.large.subtitle', { amount: shownText })}
          {shown?.approx && (
            <span className="analysis-info__tip-extra">{t('spendingAnalysis.large.convertedFrom', { amount: thresholdText })}</span>
          )}
        </InfoTip>
      </h3>

      {items.length === 0 ? (
        <p className="analysis-empty">{t('spendingAnalysis.large.empty', { amount: shownText })}</p>
      ) : (
        <ul className="analysis-large__list">
          {items.map(({ tx, value, excluded }) => {
            const [, m, d] = tx.date.split('-').map(Number);
            return (
              <li key={tx.id} className={`analysis-large__row${excluded ? ' is-out' : ''}`}>
                <span className="analysis-large__date">{m}/{d}</span>
                <span className="analysis-large__name">
                  {[tx.category, tx.itemName].filter(Boolean).join('・')}
                </span>
                <span className="analysis-large__amount">{formatTotal(value)}</span>
                <EntryButton
                  adding={excluded}
                  label={t(excluded ? 'spendingAnalysis.large.include' : 'spendingAnalysis.large.exclude')}
                  onClick={() => onToggleExcluded(tx.id, !excluded)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
