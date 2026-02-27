import { useMemo, useRef } from 'react';
import Modal from './Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { formatMoney, getDaysUntilDay, getTodayYmd } from '@/lib/utils';

function calculateCreditUsage(account, history) {
  const billingDay = account.billing_day || account.billingDay;
  const paymentDueDay = account.payment_due_day || account.paymentDueDay;
  const accountId = account.id;
  const accountName = account.name || account.accountName;

  if (!billingDay) return 0;

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  let lastBillingYear = currentYear;
  let lastBillingMonth = currentMonth;
  if (currentDay < billingDay) {
    lastBillingMonth -= 1;
    if (lastBillingMonth < 1) { lastBillingMonth = 12; lastBillingYear -= 1; }
  }

  let prevBillingYear = lastBillingYear;
  let prevBillingMonth = lastBillingMonth - 1;
  if (prevBillingMonth < 1) { prevBillingMonth = 12; prevBillingYear -= 1; }

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  const prevBillingDate = fmt(prevBillingYear, prevBillingMonth, billingDay);
  const lastBillingDate = fmt(lastBillingYear, lastBillingMonth, billingDay);

  let endDay = billingDay - 1;
  let endMonth = lastBillingMonth;
  let endYear = lastBillingYear;
  if (endDay < 1) {
    endMonth -= 1;
    if (endMonth < 1) { endMonth = 12; endYear -= 1; }
    endDay = new Date(endYear, endMonth, 0).getDate();
  }
  const lastBillingEndDate = fmt(endYear, endMonth, endDay);

  let hasPaid = false;
  if (paymentDueDay) {
    if (paymentDueDay > billingDay) {
      if (currentDay >= billingDay && currentDay >= paymentDueDay) hasPaid = true;
    } else {
      if (currentDay < billingDay && currentDay >= paymentDueDay) hasPaid = true;
    }
  }

  const todayDate = fmt(currentYear, currentMonth, currentDay);
  let totalUsed = 0;
  (history || []).forEach((tx) => {
    if (tx.type !== 'expense') return;
    const match = tx.account_id === accountId || tx.paymentMethod === accountName;
    if (!match) return;
    const txDate = tx.date;
    const amt = typeof tx.twdAmount === 'number' ? Math.abs(tx.twdAmount) : 0;
    if (!hasPaid && txDate >= prevBillingDate && txDate <= lastBillingEndDate) totalUsed += amt;
    if (txDate >= lastBillingDate && txDate <= todayDate) totalUsed += amt;
  });
  return totalUsed;
}

export default function CreditCardModal({ isOpen, onClose, account, history = [] }) {
  const data = useMemo(() => {
    if (!account) return null;
    const creditLimit = account.credit_limit || account.creditLimit;
    const billingDay = account.billing_day || account.billingDay;
    const paymentDueDay = account.payment_due_day || account.paymentDueDay;
    let usedAmount = 0;
    let available = null;
    let usagePercent = 0;
    let barColor = '#e0e0e0';
    let percentText = '';

    if (creditLimit) {
      usedAmount = calculateCreditUsage(account, history);
      available = Math.floor(Math.max(0, creditLimit - usedAmount));
      usagePercent = creditLimit > 0 ? (usedAmount / creditLimit) * 100 : 0;
      barColor = usagePercent <= 50 ? '#4caf50' : usagePercent <= 80 ? '#ff9800' : '#f44336';
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

  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen && !!account);

  if (!account || !data) return null;
  const accountName = account.name || account.accountName || '信用卡';

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="credit-card-modal">
      <div className="credit-card-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="credit-card-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="credit-card-modal__close" aria-label="關閉" onClick={onClose}>×</button>
        <h2 className="credit-card-modal__title">{accountName}</h2>
        <div className="credit-card-info">
          <div className="credit-limit-section">
            <div className="credit-limit-header">
              <span className="credit-limit-label">可用額度</span>
              <span className="credit-limit-amount">
                {data.available !== null ? formatMoney(data.available) : '未設定'}
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
                  <span>已使用：{formatMoney(data.usedAmount)}</span>
                  <span>總額度：{formatMoney(data.creditLimit)}</span>
                </div>
              </>
            ) : (
              <div className="credit-limit-detail">
                <span style={{ color: 'var(--color-text-secondary)' }}>未設定信用額度</span>
              </div>
            )}
          </div>
          <div className="credit-dates">
            <div className="credit-date-item">
              <span className="credit-date-label">帳單日</span>
              <span className="credit-date-value">{data.billingDay ? `每月 ${data.billingDay} 日` : '未設定'}</span>
              {data.billingDays !== null && (
                <span className="credit-billing-countdown">
                  還有 <span className={`credit-countdown-num${data.isBillingUrgent ? ' credit-countdown-urgent' : ''}`}>{data.billingDays}</span> 天
                </span>
              )}
            </div>
            <div className="credit-date-item">
              <span className="credit-date-label">繳款日</span>
              <span className="credit-date-value">{data.paymentDueDay ? `每月 ${data.paymentDueDay} 日` : '未設定'}</span>
              {data.paymentDays !== null && (
                <span className="credit-payment-countdown">
                  還有 <span className={`credit-countdown-num${data.isPaymentUrgent ? ' credit-countdown-urgent' : ''}`}>{data.paymentDays}</span> 天
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
