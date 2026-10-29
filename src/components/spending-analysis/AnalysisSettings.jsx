import { useState, useRef, useCallback } from 'react';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { formatNumberWithCommas, parseFormattedNumber } from '@/lib/utils';
import { useAmountInput } from '@/hooks/useAmountInput';
import { monthsBetween, roundForCurrency } from '@/lib/spendingAnalysis';

const AUTO = 'auto';

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
  </svg>
);

/** 面板一打開時的內容：起點（比開始記帳還早就從開始記帳那個月算）與門檻（顯示幣別、加千分位） */
const initialValues = (startYm, firstYm, shown) => ({
  start: !startYm ? AUTO : startYm < firstYm ? firstYm : startYm,
  amount: shown ? formatNumberWithCommas(String(shown.amount)) : '',
});

/**
 * 頁面右上角的設定按鈕：這一頁要設定的（分析起點、大額門檻）都在點開的彈窗裡。
 * 按儲存就關掉，數字當下換成新的設定算；雲端存檔由頁面在背景跑。點外面或按 Esc 不存直接關掉。
 * 沒動到的欄位不送出：門檻換算成別的幣別時顯示的是取整數的近似值，原樣存回去會把原本的門檻改掉。
 *
 * @param {string|null} startYm 目前存的起點；null 是自動
 * @param {string} firstYm 帳本第一筆交易的月份（最早可以選到這裡）
 * @param {string} currentYm 這個月（最晚可以選到這裡）
 * @param {(ym: string) => string} labelOfYm 'YYYY-MM' → 「2026年1月」
 * @param {{ amount: number, currency: string } | null} shown 門檻在顯示幣別下的金額（thresholdForDisplay）
 * @param {(changes: { startYm?: string|null, thresholdAmount?: number }) => string|null} onSave
 *        只帶有改的欄位；不能存（匯率讀不到）時回傳錯誤訊息
 */
export default function AnalysisSettings({ startYm, firstYm, currentYm, labelOfYm, shown, onSave }) {
  const { t } = useLanguage();
  const { currency } = useDisplayAmount();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState(null);
  const [start, setStart] = useState(AUTO);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  // 跟記帳的金額欄同一套：邊打邊加千分位逗號、游標不跳、貼上也會整理
  const inputRef = useRef(null);
  const setAmountForm = useCallback((update) => setAmount((prev) => update({ amount: prev }).amount), []);
  const { handleAmountChange, handleAmountBlur, handleAmountPaste } = useAmountInput(inputRef, setAmountForm);
  const options = monthsBetween(firstYm, currentYm).reverse();

  const openModal = () => {
    const values = initialValues(startYm, firstYm, shown);
    setInitial(values);
    setStart(values.start);
    setAmount(values.amount);
    setError(null);
    setOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const changes = {};
    if (start !== initial.start) changes.startYm = start === AUTO ? null : start;
    if (amount !== initial.amount) {
      const value = roundForCurrency(Number(parseFormattedNumber(amount)), currency);
      if (!(value > 0)) {
        setError(t('spendingAnalysis.settings.thresholdInvalid'));
        return;
      }
      changes.thresholdAmount = value;
    }
    const failure = onSave(changes);
    if (failure) setError(failure);
    else setOpen(false);
  };

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="analysis-icon-btn analysis-settings__btn"
        aria-label={t('spendingAnalysis.settings.title')}
        title={t('spendingAnalysis.settings.title')}
        onClick={openModal}
      >
        <SettingsIcon />
      </button>
      <Modal isOpen={open} onClose={close} className="category-detail-modal" titleId="analysis-settings-title">
        <div className="category-detail-modal__backdrop" onClick={close} />
        <form className="category-detail-modal__dialog analysis-trip-form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
          <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={close}>×</button>
          <h2 id="analysis-settings-title" className="category-detail-modal__title">{t('spendingAnalysis.settings.title')}</h2>

          <label className="analysis-field">
            <span className="analysis-field__label">{t('spendingAnalysis.settings.startLabel')}</span>
            <select className="analysis-input" value={start} onChange={(e) => setStart(e.target.value)} autoFocus>
              <option value={AUTO}>{t('spendingAnalysis.settings.startAuto')}</option>
              {options.map((ym) => <option key={ym} value={ym}>{labelOfYm(ym)}</option>)}
            </select>
          </label>
          <label className="analysis-field">
            <span className="analysis-field__label">{t('spendingAnalysis.settings.thresholdLabel')}</span>
            <span className="analysis-settings__amount">
              <span className="analysis-settings__currency">{currency}</span>
              <input
                ref={inputRef}
                className="analysis-input"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                onBlur={handleAmountBlur}
                onPaste={handleAmountPaste}
              />
            </span>
          </label>
          {error && <p className="analysis-trip-form__error" role="alert">{error}</p>}

          <div className="analysis-trip-form__actions">
            <button type="button" className="analysis-btn analysis-btn--quiet" onClick={close}>{t('common.cancel')}</button>
            <button type="submit" className="analysis-btn analysis-btn--primary">{t('spendingAnalysis.settings.save')}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
