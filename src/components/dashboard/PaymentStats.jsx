import { useMemo } from 'react';
import { formatMoney } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export default function PaymentStats({ history = [], accounts = [], onOpenCreditCard, onSelectMethod, periodName }) {
  const { t } = useLanguage();
  const pairs = useMemo(() => {
    const byMethod = {};
    (history || []).forEach((tx) => {
      const m = (tx.paymentMethod && String(tx.paymentMethod).trim()) ? tx.paymentMethod : t('transaction.other');
      const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
      if (!byMethod[m]) byMethod[m] = { value: 0, txs: [] };
      byMethod[m].value += amt;
      byMethod[m].txs.push(tx);
    });
    return Object.entries(byMethod)
      .map(([label, { value, txs }]) => ({ label, value, txs }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [history, t]);

  // 占比分母：本期各支付方式的絕對值總和（這份統計含收入，故不叫支出）
  const totalPayment = useMemo(
    () => pairs.reduce((sum, p) => sum + Math.abs(p.value), 0),
    [pairs]
  );

  if (pairs.length === 0) {
    return <p className="payment-stats-empty">{t('dashboard.noPaymentData', { period: periodName })}</p>;
  }

  return (
    <ul className="payment-stats-list" id="paymentStats">
      {pairs.map((p) => {
        const account = accounts.find((a) => (a.name || a.accountName) === p.label);
        const isCreditCard = account?.type === 'credit_card';
        // 信用卡走額度管理彈窗（明細接在額度下方），其餘走一般明細彈窗
        const select = isCreditCard && account
          ? () => onOpenCreditCard?.(account, p)
          : onSelectMethod
            ? () => onSelectMethod({ ...p, kind: 'payment', totalExpense: totalPayment })
            : null;
        return (
          <li
            key={p.label}
            className={select ? 'clickable' : ''}
            role={select ? 'button' : undefined}
            tabIndex={select ? 0 : undefined}
            onClick={select || undefined}
            onKeyDown={select ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : undefined}
          >
            <span className="pay-name">{p.label}</span>
            <span className="pay-amount">{formatMoney(p.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
