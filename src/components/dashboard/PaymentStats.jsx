import { useMemo } from 'react';
import { formatMoney } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export default function PaymentStats({ history = [], accounts = [], onOpenCreditCard }) {
  const { t } = useLanguage();
  const pairs = useMemo(() => {
    const byMethod = {};
    (history || []).forEach((tx) => {
      const m = (tx.paymentMethod && String(tx.paymentMethod).trim()) ? tx.paymentMethod : t('transaction.other');
      const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
      byMethod[m] = (byMethod[m] || 0) + amt;
    });
    return Object.entries(byMethod)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [history, t]);

  if (pairs.length === 0) {
    return <p className="payment-stats-empty">{t('dashboard.noPaymentData')}</p>;
  }

  return (
    <ul className="payment-stats-list" id="paymentStats">
      {pairs.map((p) => {
        const account = accounts.find((a) => (a.name || a.accountName) === p.label);
        const isCreditCard = account?.type === 'credit_card';
        return (
          <li
            key={p.label}
            className={isCreditCard ? 'clickable' : ''}
            role={isCreditCard ? 'button' : undefined}
            tabIndex={isCreditCard ? 0 : undefined}
            onClick={isCreditCard && account ? () => onOpenCreditCard?.(account) : undefined}
            onKeyDown={isCreditCard && account ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenCreditCard?.(account); } } : undefined}
          >
            <span className="pay-name">{p.label}</span>
            <span className="pay-amount">{formatMoney(p.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
