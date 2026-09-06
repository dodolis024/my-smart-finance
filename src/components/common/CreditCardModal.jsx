import { useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import TransactionListPanel from '@/components/transactions/TransactionListPanel';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { formatMoney, getDaysUntilDay } from '@/lib/utils';
import { calculateCreditUsage } from '@/lib/creditCard';
import { useLanguage } from '@/contexts/LanguageContext';

// 額度管理是這個彈窗的主角：額度／帳單日永遠在最上方，本期紀錄接在下方。
// 額度用 history（帳單週期、即時），紀錄用 txs（目前檢視的月／年），兩者期間本就不同。
export default function CreditCardModal({
  isOpen, onClose, account, history = [], viewedYear, viewedMonth, otherPeriod,
  txs, onEdit, onDelete, periodName,
}) {
  const now = new Date();
  // otherPeriod 由上層明確指定（年檢視一律視為「非當月」：只傳 viewedYear 且剛好是今年會被誤判成當月）；
  // 未指定時維持原本的年月比對，月檢視行為不變
  const isViewingOtherMonth = otherPeriod != null
    ? otherPeriod
    : (viewedYear != null && viewedYear !== now.getFullYear()) ||
      (viewedMonth != null && viewedMonth !== now.getMonth() + 1);

  const data = useMemo(() => {
    if (!account) return null;
    const creditLimit = account.credit_limit || account.creditLimit;
    const billingDay = account.billing_day || account.billingDay;
    const paymentDueDay = account.payment_due_day || account.paymentDueDay;
    let usedAmount = 0;
    let available = null;
    let usagePercent = 0;
    let barColor = 'var(--color-progress-track)';
    let percentText = '';

    if (creditLimit) {
      usedAmount = calculateCreditUsage(account, history);
      available = Math.floor(Math.max(0, creditLimit - usedAmount));
      usagePercent = creditLimit > 0 ? (usedAmount / creditLimit) * 100 : 0;
      barColor = usagePercent <= 50 ? 'var(--color-progress-safe)'
        : usagePercent <= 80 ? 'var(--color-progress-warn)'
        : 'var(--color-progress-danger)';
      percentText = usagePercent % 1 === 0 ? `${Math.round(usagePercent)}%` : `${usagePercent.toFixed(1)}%`;
    }

    const billingDays = billingDay ? getDaysUntilDay(billingDay) : null;
    const paymentDays = paymentDueDay ? getDaysUntilDay(paymentDueDay) : null;
    const isBillingUrgent = billingDays !== null && billingDays <= 5;
    const isPaymentUrgent = paymentDays !== null && paymentDays <= 5;

    return {
      creditLimit, usedAmount, available, usagePercent, barColor, percentText,
      billingDay, paymentDueDay, billingDays, paymentDays, isBillingUrgent, isPaymentUrgent,
    };
  }, [account, history]);

  const { t } = useLanguage();
  const dialogRef = useRef(null);
  // 排序偏好刻意跨開關保留：選過金額的人多半下一次還想看金額
  const [sortBy, setSortBy] = useState('date');
  useScrollbarOnScroll(dialogRef, isOpen && !!account);

  const rows = txs || [];
  const rowsTotal = rows.reduce((sum, tx) => sum + (typeof tx.twdAmount === 'number' ? tx.twdAmount : 0), 0);

  if (!account || !data) return null;
  const accountName = account.name || account.accountName || t('creditCard.defaultName');

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="credit-card-modal" titleId="credit-card-modal-title">
      <div className="credit-card-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="credit-card-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="credit-card-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="credit-card-modal-title" className="credit-card-modal__title">{accountName}</h2>
        {isViewingOtherMonth && (
          <p className="credit-card-modal__live-hint">
            {viewedMonth == null
              ? t('creditCard.liveDataHintYear', { year: viewedYear })
              : t('creditCard.liveDataHint', { year: viewedYear, month: viewedMonth })}
          </p>
        )}
        <div className="credit-card-info">
          <div className="credit-limit-section">
            <div className="credit-limit-header">
              <span className="credit-limit-label">{t('creditCard.availableCredit')}</span>
              <span className="credit-limit-amount">
                {data.available !== null ? formatMoney(data.available) : t('creditCard.notSet')}
              </span>
            </div>
            {data.creditLimit ? (
              <>
                <div className="credit-limit-progress-row">
                  <div className="credit-limit-progress">
                    <div
                      className="credit-limit-bar"
                      style={{ width: `${Math.min(100, data.usagePercent)}%`, backgroundColor: data.barColor }}
                    />
                  </div>
                  <span className="credit-limit-percent" style={{ color: data.barColor }}>{data.percentText}</span>
                </div>
                <div className="credit-limit-detail">
                  <span>{t('creditCard.used')}{formatMoney(data.usedAmount)}</span>
                  <span>{t('creditCard.total')}{formatMoney(data.creditLimit)}</span>
                </div>
              </>
            ) : (
              <div className="credit-limit-detail">
                <span style={{ color: 'var(--color-text-secondary)' }}>{t('creditCard.limitNotSet')}</span>
              </div>
            )}
          </div>
          <div className="credit-dates">
            <div className="credit-date-item">
              <span className="credit-date-label">{t('creditCard.billingDay')}</span>
              <span className="credit-date-value">{data.billingDay ? t('creditCard.dayOfMonth', { day: data.billingDay }) : t('creditCard.notSet')}</span>
              {data.billingDays !== null && (
                <span className="credit-billing-countdown">
                  <span className={`credit-countdown-num${data.isBillingUrgent ? ' credit-countdown-urgent' : ''}`}>{t('creditCard.daysLeft', { days: data.billingDays })}</span>
                </span>
              )}
            </div>
            <div className="credit-date-item">
              <span className="credit-date-label">{t('creditCard.paymentDueDay')}</span>
              <span className="credit-date-value">{data.paymentDueDay ? t('creditCard.dayOfMonth', { day: data.paymentDueDay }) : t('creditCard.notSet')}</span>
              {data.paymentDays !== null && (
                <span className="credit-payment-countdown">
                  <span className={`credit-countdown-num${data.isPaymentUrgent ? ' credit-countdown-urgent' : ''}`}>{t('creditCard.daysLeft', { days: data.paymentDays })}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {txs && (
          <section className="credit-card-records">
            <div className="credit-card-records__header">
              <h3 className="credit-card-records__title">{t('creditCard.records', { period: periodName })}</h3>
              <span className="credit-card-records__meta">
                {t('dashboard.categoryDetailCount', { count: rows.length })}
                {rows.length > 0 && ` · ${formatMoney(rowsTotal)}`}
              </span>
            </div>
            <TransactionListPanel
              txs={rows}
              isOpen={isOpen}
              resetKey={account}
              sortBy={sortBy}
              onSortChange={setSortBy}
              emptyText={t('creditCard.recordsEmpty', { period: periodName })}
              onEdit={onEdit}
              onDelete={onDelete}
              onCloseParent={onClose}
            />
          </section>
        )}
      </div>
    </Modal>
  );
}
