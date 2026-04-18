import { useMemo, useRef } from 'react';
import Modal from './Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { formatMoney, getDaysUntilDay } from '@/lib/utils';
import { calculateCreditUsage } from '@/lib/creditCard';
import { useLanguage } from '@/contexts/LanguageContext';

export default function CreditCardModal({ isOpen, onClose, account, history = [] }) {
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
  useScrollbarOnScroll(dialogRef, isOpen && !!account);

  if (!account || !data) return null;
  const accountName = account.name || account.accountName || t('creditCard.defaultName');

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="credit-card-modal" titleId="credit-card-modal-title">
      <div className="credit-card-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="credit-card-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="credit-card-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="credit-card-modal-title" className="credit-card-modal__title">{accountName}</h2>
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
      </div>
    </Modal>
  );
}
