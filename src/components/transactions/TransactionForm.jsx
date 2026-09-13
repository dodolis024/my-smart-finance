import { useState, useEffect, useRef, useCallback } from 'react';
import { getTodayYmd, getNowHm, formatNumberWithCommas } from '@/lib/utils';
import { useAmountInput } from '@/hooks/useAmountInput';
import { useLanguage } from '@/contexts/LanguageContext';
import { getOverseasFeeRate, defaultOverseasChecked } from '@/lib/overseasFee';

// 備註展開與否記在本機：手動開合才會寫入，自動展開（編輯有備註的交易）不算數
const NOTE_OPEN_KEY = 'transaction-form-note-open';
const readNoteOpenPref = () => {
  try { return localStorage.getItem(NOTE_OPEN_KEY) === 'true'; } catch { return false; }
};

const makeInitialForm = (defaultCurrency = 'TWD') => ({
  date: getTodayYmd(),
  time: getNowHm(),
  itemName: '',
  categoryValue: '',
  paymentMethod: '',
  currency: defaultCurrency,
  amount: '',
  note: '',
  overseas: false,
});

export default function TransactionForm({
  categoriesExpense = [],
  categoriesIncome = [],
  accounts = [],
  currencies = ['TWD'],
  defaultCurrency = 'TWD',
  editingTransaction = null,
  /** 分帳同步進帳本的交易：可不填支付方式 */
  paymentOptional = false,
  onSubmit,
  onCancelEdit,
  onCheckin,
  hasCheckinToday = false,
  disabled = false,
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState(() => makeInitialForm(defaultCurrency));
  const [submitting, setSubmitting] = useState(false);
  // 備註是選填，手機版預設收合成一列標題；編輯本來就有備註的交易時自動展開
  const [noteOpen, setNoteOpen] = useState(readNoteOpenPref);
  const amountRef = useRef(null);
  // 記錄使用者是否手動選過幣別：手動選過就不再被預設幣別覆蓋
  const currencyTouchedRef = useRef(false);
  // 記錄使用者是否親手點過「海外消費」：點過就不再依卡片／幣別自動改它
  const overseasTouchedRef = useRef(false);
  const { handleAmountChange, handleAmountBlur, handleAmountPaste } = useAmountInput(amountRef, setForm);

  useEffect(() => {
    if (editingTransaction) {
      const amountValue =
        editingTransaction.originalAmount != null
          ? editingTransaction.originalAmount
          : editingTransaction.twdAmount != null
          ? editingTransaction.twdAmount
          : '';
      const currencyVal = (editingTransaction.currency || 'TWD').toUpperCase();
      const cat = String(editingTransaction.category || '');
      const txType = String(editingTransaction.type || 'expense');
      const prefixedValue = (txType === 'income' ? 'income:' : 'expense:') + cat;

      setForm({
        date: editingTransaction.date || getTodayYmd(),
        // 舊資料可能沒有 time（migration 前建立）：退回目前時間
        time: editingTransaction.time ? editingTransaction.time.slice(0, 5) : getNowHm(),
        itemName: editingTransaction.itemName || '',
        categoryValue: prefixedValue,
        paymentMethod: editingTransaction.paymentMethod || '',
        currency: currencyVal,
        amount: amountValue ? formatNumberWithCommas(String(amountValue)) : '',
        note: editingTransaction.note || '',
        // 載入時顯示這筆實際存的狀態，不套用卡片預設
        overseas: (editingTransaction.overseasFeeRate ?? editingTransaction.overseas_fee_rate) != null,
      });
      overseasTouchedRef.current = false;
      setNoteOpen(Boolean(editingTransaction.note) || readNoteOpenPref());
    } else {
      currencyTouchedRef.current = false;
      overseasTouchedRef.current = false;
      setForm(makeInitialForm(defaultCurrency));
      setNoteOpen(readNoteOpenPref());
    }
  }, [editingTransaction]); // eslint-disable-line react-hooks/exhaustive-deps -- 僅在切換編輯對象時重設表單，defaultCurrency 不應觸發重設

  // 預設幣別可能較晚載入（冷啟動）或於設定頁被變更：
  // 只要使用者尚未手動選過幣別，就同步為使用者預設值
  useEffect(() => {
    if (editingTransaction || currencyTouchedRef.current) return;
    setForm((prev) => (prev.currency === defaultCurrency ? prev : { ...prev, currency: defaultCurrency }));
  }, [defaultCurrency, editingTransaction]);

  // 改支付方式／幣別／分類時重算「海外消費」預設值（使用者親手點過就不動）。
  // 只在使用者操作時重算，不可改成監聽 form 的 effect：編輯載入時會把存好的狀態蓋掉
  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    if (name === 'currency') currencyTouchedRef.current = true;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (!overseasTouchedRef.current && (name === 'paymentMethod' || name === 'currency' || name === 'categoryValue')) {
        const acc = accounts.find((a) => (a.accountName || a.name) === next.paymentMethod);
        const txType = String(next.categoryValue).startsWith('income:') ? 'income' : 'expense';
        next.overseas = defaultOverseasChecked(acc, next.currency, txType);
      }
      return next;
    });
  }, [accounts]);

  const handleOverseasChange = (e) => {
    overseasTouchedRef.current = true;
    const { checked } = e.target;
    setForm((prev) => ({ ...prev, overseas: checked }));
  };

  // <input type="datetime-local"> 的 value 是 "YYYY-MM-DDTHH:mm" 單一字串；
  // 拆回 date/time 兩個欄位存放（後端維持分開存的 schema）。任一段不完整時
  // 瀏覽器會把整個 value 清空，此時保留原本的值，避免日期被意外清掉
  const handleDateTimeChange = useCallback((e) => {
    const [date, time] = e.target.value.split('T');
    if (!date || !time) return;
    setForm((prev) => ({ ...prev, date, time }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit({ ...form, overseas: showOverseas && form.overseas }, editingTransaction?.id ?? null);
      currencyTouchedRef.current = false;
      overseasTouchedRef.current = false;
      setForm(makeInitialForm(defaultCurrency));
      setNoteOpen(readNoteOpenPref());
    } catch {
      // Error is handled and displayed by the parent
    } finally {
      setSubmitting(false);
    }
  };

  // 只有使用者親手開合才記住；自動展開不覆寫偏好
  const handleNoteToggle = () => {
    const next = !noteOpen;
    setNoteOpen(next);
    try { localStorage.setItem(NOTE_OPEN_KEY, String(next)); } catch { /* 無痕模式等寫不進去就算了 */ }
  };

  const isEditing = !!editingTransaction;
  const isFormDisabled = submitting || disabled;

  const allCategoryValues = [
    ...categoriesExpense.map((c) => `expense:${c}`),
    ...categoriesIncome.map((c) => `income:${c}`),
  ];
  const needsExtraCategory =
    isEditing && form.categoryValue && !allCategoryValues.includes(form.categoryValue);
  const needsExtraPayment =
    isEditing &&
    form.paymentMethod &&
    !accounts.some((a) => (a.accountName || a.name) === form.paymentMethod);
  const needsExtraCurrency = form.currency && !currencies.includes(form.currency);

  const selectedAccount = accounts.find((a) => (a.accountName || a.name) === form.paymentMethod);
  const isIncome = String(form.categoryValue).startsWith('income:');
  // 選到有費率的卡才出現；編輯一筆原本就是海外消費的帳（卡片費率後來被刪掉）時也要出現，才能取消
  const showOverseas =
    !paymentOptional && !isIncome &&
    (getOverseasFeeRate(selectedAccount) != null || (isEditing && form.overseas));

  return (
    <section className="transaction-form-section">
      <div className="transaction-form-header">
        <h2 id="formSectionTitle">{isEditing ? t('transaction.editTitle') : t('transaction.addTitle')}</h2>
        <button
          type="button"
          className={`btn-checkin${hasCheckinToday ? ' btn-checkin-disabled' : ''}`}
          onClick={onCheckin}
          disabled={hasCheckinToday || isFormDisabled}
          aria-label={t('transaction.checkinAriaLabel')}
        >
          <span className="btn-checkin-icon" aria-hidden="true">
            <svg className="icon-checkin" aria-hidden="true">
              <use href="#icon-checkin" />
            </svg>
          </span>
          <span className="btn-checkin-text">{t('transaction.checkinBtn')}</span>
        </button>
      </div>

      <form id="transactionForm" onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="date">{t('transaction.date')}</label>
          <input
            type="datetime-local"
            id="date"
            name="date"
            value={`${form.date}T${form.time}`}
            onChange={handleDateTimeChange}
            disabled={isFormDisabled}
          />
        </div>

        <div className="form-group">
          <label htmlFor="item">{t('transaction.itemName')}</label>
          <input
            type="text"
            id="item"
            name="itemName"
            value={form.itemName}
            onChange={handleChange}
            required
            disabled={isFormDisabled}
          />
        </div>

        <div className="form-group">
          <label htmlFor="category">{t('transaction.category')}</label>
          <select
            id="category"
            name="categoryValue"
            value={form.categoryValue}
            onChange={handleChange}
            disabled={isFormDisabled}
          >
            <option value="" disabled>
              {t('transaction.selectCategory')}
            </option>
            {needsExtraCategory && (
              <option value={form.categoryValue}>{form.categoryValue.split(':').pop()}</option>
            )}
            {categoriesExpense.length > 0 && (
              <optgroup label={t('transaction.expenseGroup')}>
                {categoriesExpense.map((c) => (
                  <option key={`expense:${c}`} value={`expense:${c}`}>
                    {c}
                  </option>
                ))}
              </optgroup>
            )}
            {categoriesIncome.length > 0 && (
              <optgroup label={t('transaction.incomeGroup')}>
                {categoriesIncome.map((c) => (
                  <option key={`income:${c}`} value={`income:${c}`}>
                    {c}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="form-group">
          <div className="form-group__label-row">
            <label htmlFor="method">{t('transaction.paymentMethod')}</label>
            {showOverseas && (
              <label className="overseas-toggle" htmlFor="overseas">
                <input
                  type="checkbox"
                  id="overseas"
                  name="overseas"
                  checked={form.overseas}
                  onChange={handleOverseasChange}
                  disabled={isFormDisabled}
                />
                <span>{t('transaction.overseasToggle')}</span>
              </label>
            )}
          </div>
          <select
            id="method"
            name="paymentMethod"
            value={form.paymentMethod}
            onChange={handleChange}
            disabled={isFormDisabled}
            required={!paymentOptional}
          >
            {paymentOptional ? (
              <option value="">{t('transaction.noPaymentSplitSync')}</option>
            ) : (
              <option value="" disabled>
                {t('transaction.selectPaymentMethod')}
              </option>
            )}
            {needsExtraPayment && (
              <option value={form.paymentMethod}>{form.paymentMethod}</option>
            )}
            {accounts.map((acc) => {
              const name = acc.accountName || acc.name;
              if (!name) return null;
              return (
                <option key={name} value={name}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="form-group form-group--currency-amount">
          <label htmlFor="amount" className="form-group__amount-label">
            {t('transaction.amount')}
          </label>
          <div className="form-group__currency-amount-row">
            <div className="form-group__currency">
              <select
                id="currency"
                name="currency"
                value={form.currency}
                onChange={handleChange}
                disabled={isFormDisabled}
              >
                {needsExtraCurrency && (
                  <option value={form.currency}>{form.currency}</option>
                )}
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group__amount">
              <input
                type="text"
                id="amount"
                name="amount"
                ref={amountRef}
                value={form.amount}
                onChange={handleAmountChange}
                onBlur={handleAmountBlur}
                onPaste={handleAmountPaste}
                inputMode="decimal"
                required
                disabled={isFormDisabled}
              />
            </div>
          </div>
        </div>

        <div className={`form-group form-group--note${noteOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="note-toggle"
            onClick={handleNoteToggle}
            aria-expanded={noteOpen}
            aria-controls="note"
            disabled={isFormDisabled}
          >
            {t('transaction.note')}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className={`note-toggle__chevron${noteOpen ? ' is-open' : ''}`}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <label htmlFor="note">{t('transaction.note')}</label>
          <textarea
            id="note"
            name="note"
            value={form.note}
            onChange={handleChange}
            rows={3}
            placeholder={t('transaction.noteOptional')}
            aria-label={t('transaction.note')}
            disabled={isFormDisabled}
          />
        </div>

        <div className="form-actions">
          {isEditing && (
            <button
              type="button"
              className="btn-cancel"
              onClick={onCancelEdit}
              disabled={submitting}
            >
              {t('common.cancel')}
            </button>
          )}
          <button type="submit" disabled={isFormDisabled}>
            {submitting ? t('common.saving') : isEditing ? t('transaction.updateBtn') : t('transaction.addBtn')}
          </button>
        </div>
      </form>
    </section>
  );
}
