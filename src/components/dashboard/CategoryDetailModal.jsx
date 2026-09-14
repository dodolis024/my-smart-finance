import { useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import TransactionListPanel from '@/components/transactions/TransactionListPanel';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

// 分類明細，也服務支付方式明細（category.kind === 'payment'）：
// 兩者結構一樣（標題 + 總額 + 清單），只有占比那句文案不同。
export default function CategoryDetailModal({ isOpen, onClose, category, onEdit, onDelete, periodName }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  const dialogRef = useRef(null);
  // 排序偏好刻意跨開關保留：選過金額的人多半下一次還想看金額
  const [sortBy, setSortBy] = useState('date');
  useScrollbarOnScroll(dialogRef, isOpen && !!category);

  if (!category) return null;

  const isPayment = category.kind === 'payment';
  const rows = category.txs || [];
  const total = Math.abs(category.value);
  const share = category.totalExpense > 0 ? (total / category.totalExpense) * 100 : 0;
  const shareText = share % 1 === 0 ? String(Math.round(share)) : share.toFixed(1);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="category-detail-modal" titleId="category-detail-modal-title">
      <div className="category-detail-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="category-detail-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="category-detail-modal-title" className="category-detail-modal__title">{category.label}</h2>

        <div className="category-detail-modal__summary">
          <span className="category-detail-modal__total">{formatTotal(category.value)}</span>
          <span className="category-detail-modal__meta">
            {t('dashboard.categoryDetailCount', { count: rows.length })}
            {' · '}
            {t(isPayment ? 'dashboard.paymentDetailShare' : 'dashboard.categoryDetailShare', { percent: shareText, period: periodName })}
          </span>
        </div>

        <TransactionListPanel
          txs={rows}
          isOpen={isOpen}
          resetKey={category}
          sortBy={sortBy}
          onSortChange={setSortBy}
          emptyText={t(isPayment ? 'dashboard.paymentDetailEmpty' : 'dashboard.categoryDetailEmpty', { period: periodName })}
          onEdit={onEdit}
          onDelete={onDelete}
          onCloseParent={onClose}
        />
      </div>
    </Modal>
  );
}
