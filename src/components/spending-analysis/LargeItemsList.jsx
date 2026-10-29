import { useState, useRef, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { formatOriginalMoney, formatNumberWithCommas, parseFormattedNumber } from '@/lib/utils';
import { useAmountInput } from '@/hooks/useAmountInput';
import { roundForCurrency } from '@/lib/spendingAnalysis';
import InfoTip from '@/components/spending-analysis/InfoTip';

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
  </svg>
);

/** 門檻金額：整數就不印小數（£250、$10,000） */
const formatAmount = ({ amount, currency }) =>
  formatOriginalMoney(amount, currency, { wholeUnits: Number.isInteger(amount) });

/**
 * 正在看的這個月的大額消費：只列出來，金額照樣算在上面的分析裡。
 * 標題旁的按鈕可以改門檻；金額用正在顯示的幣別輸入。
 *
 * @param {{ tx: object, value: number }[]} items
 * @param {{ amount: number, currency: string }} threshold 使用者存的門檻（判斷一律照它）
 * @param {{ amount: number, currency: string, approx: boolean } | null} shown 門檻在顯示幣別下怎麼寫（thresholdForDisplay）
 * @param {(amount: number) => string|null} onSaveThreshold 存新門檻；不能存（匯率讀不到）時回傳錯誤訊息，
 *        存檔本身在背景進行、失敗由頁面跳提示
 */
export default function LargeItemsList({ items, threshold, shown, onSaveThreshold }) {
  const { t } = useLanguage();
  const { formatTotal, currency } = useDisplayAmount();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const thresholdText = formatAmount(threshold);
  // 換算出來的數字前面加「約」，小 i 補一句是從哪個金額換算的
  const shownText = !shown ? thresholdText : shown.approx
    ? t('spendingAnalysis.large.approx', { amount: formatAmount(shown) })
    : formatAmount(shown);
  // 跟記帳的金額欄同一套：邊打邊加千分位逗號、游標不跳、貼上也會整理
  const inputRef = useRef(null);
  const setAmountForm = useCallback((update) => setInput((prev) => update({ amount: prev }).amount), []);
  const { handleAmountChange, handleAmountBlur, handleAmountPaste } = useAmountInput(inputRef, setAmountForm);

  const openForm = () => {
    setInput(shown ? formatNumberWithCommas(String(shown.amount)) : '');
    setError(null);
    setEditing((v) => !v);
  };

  // 新門檻當下就套用到清單，小框也馬上收起來；雲端存檔在背景跑
  const handleSubmit = (e) => {
    e.preventDefault();
    const amount = roundForCurrency(Number(parseFormattedNumber(input)), currency);
    if (!(amount > 0)) {
      setError(t('spendingAnalysis.large.thresholdInvalid'));
      return;
    }
    const failure = onSaveThreshold(amount);
    if (failure) setError(failure);
    else setEditing(false);
  };

  return (
    <section className="analysis-card analysis-large">
      <div className="analysis-large__head">
        <h3 className="analysis-card__title">
          {t('spendingAnalysis.large.title')}
          <InfoTip>
            {t('spendingAnalysis.large.subtitle', { amount: shownText })}
            {shown?.approx && (
              <span className="analysis-info__tip-extra">{t('spendingAnalysis.large.convertedFrom', { amount: thresholdText })}</span>
            )}
          </InfoTip>
        </h3>
        <button
          type="button"
          className="analysis-icon-btn"
          aria-label={t('spendingAnalysis.large.setThreshold')}
          title={t('spendingAnalysis.large.setThreshold')}
          aria-expanded={editing}
          onClick={openForm}
        >
          <SettingsIcon />
        </button>
      </div>

      {editing && (
        <form className="analysis-large__form" onSubmit={handleSubmit}>
          <label className="analysis-large__form-label" htmlFor="large-threshold-input">
            {t('spendingAnalysis.large.thresholdLabel')}
          </label>
          <span className="analysis-large__form-currency">{currency}</span>
          <input
            id="large-threshold-input"
            ref={inputRef}
            className="analysis-input analysis-large__form-input"
            type="text"
            inputMode="decimal"
            value={input}
            onChange={handleAmountChange}
            onBlur={handleAmountBlur}
            onPaste={handleAmountPaste}
            autoFocus
          />
          <button type="submit" className="analysis-btn analysis-btn--primary">
            {t('spendingAnalysis.large.save')}
          </button>
          <button type="button" className="analysis-btn analysis-btn--quiet" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
          {error && <p className="analysis-large__form-error" role="alert">{error}</p>}
        </form>
      )}

      {items.length === 0 ? (
        <p className="analysis-empty">{t('spendingAnalysis.large.empty', { amount: shownText })}</p>
      ) : (
        <ul className="analysis-large__list">
          {items.map(({ tx, value }) => {
            const [, m, d] = tx.date.split('-').map(Number);
            return (
              <li key={tx.id} className="analysis-large__row">
                <span className="analysis-large__date">{m}/{d}</span>
                <span className="analysis-large__name">
                  {[tx.category, tx.itemName].filter(Boolean).join('・')}
                </span>
                <span className="analysis-large__amount">{formatTotal(value)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
