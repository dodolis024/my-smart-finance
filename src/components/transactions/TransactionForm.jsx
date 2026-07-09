import { useState, useEffect, useRef, useCallback } from 'react';
import { getTodayYmd, formatNumberWithCommas } from '@/lib/utils';
import { useAmountInput } from '@/hooks/useAmountInput';
import { useLanguage } from '@/contexts/LanguageContext';

const makeInitialForm = (defaultCurrency = 'TWD') => ({
  date: getTodayYmd(),
  itemName: '',
  categoryValue: '',
  paymentMethod: '',
  currency: defaultCurrency,
  amount: '',
  note: '',
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
  const amountRef = useRef(null);
  // 記錄使用者是否手動選過幣別：手動選過就不再被預設幣別覆蓋
  const currencyTouchedRef = useRef(false);
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
        itemName: editingTransaction.itemName || '',
        categoryValue: prefixedValue,
        paymentMethod: editingTransaction.paymentMethod || '',
        currency: currencyVal,
        amount: amountValue ? formatNumberWithCommas(String(amountValue)) : '',
        note: editingTransaction.note || '',
      });
    } else {
      currencyTouchedRef.current = false;
      setForm(makeInitialForm(defaultCurrency));
    }
  }, [editingTransaction]); // eslint-disable-line react-hooks/exhaustive-deps -- 僅在切換編輯對象時重設表單，defaultCurrency 不應觸發重設

  // 預設幣別可能較晚載入（冷啟動）或於設定頁被變更：
  // 只要使用者尚未手動選過幣別，就同步為使用者預設值
  useEffect(() => {
    if (editingTransaction || currencyTouchedRef.current) return;
    setForm((prev) => (prev.currency === defaultCurrency ? prev : { ...prev, currency: defaultCurrency }));
  }, [defaultCurrency, editingTransaction]);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    if (name === 'currency') currencyTouchedRef.current = true;
    setForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(form, editingTransaction?.id ?? null);
      currencyTouchedRef.current = false;
      setForm(makeInitialForm(defaultCurrency));
    } catch {
      // Error is handled and displayed by the parent
    } finally {
      setSubmitting(false);
    }
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
            type="date"
            id="date"
            name="date"
            value={form.date}
            onChange={handleChange}
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
          <label htmlFor="method">{t('transaction.paymentMethod')}</label>
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

        <div className="form-group">
          <label htmlFor="note">{t('transaction.note')}</label>
          <textarea
            id="note"
            name="note"
            value={form.note}
            onChange={handleChange}
            rows={3}
            placeholder={t('transaction.noteOptional')}
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
