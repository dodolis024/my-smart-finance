import { useState, useMemo, useRef, useCallback } from 'react';
import TransactionRow from './TransactionRow';
import FilterPopover from './FilterPopover';
import TransactionDetail from './TransactionDetail';
import { useLanguage } from '@/contexts/LanguageContext';

export default function TransactionTable({ transactions = [], onEdit, onDelete, loading }) {
  const { t } = useLanguage();
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [activeFilter, setActiveFilter] = useState(null);
  const [detailTx, setDetailTx] = useState(null);

  const categoryBtnRef = useRef(null);
  const paymentBtnRef = useRef(null);

  const allCategories = useMemo(
    () => [...new Set(transactions.map((tx) => (tx.category && String(tx.category).trim()) || t('transaction.uncategorized')).filter(Boolean))].sort(),
    [transactions, t]
  );

  const allPayments = useMemo(
    () => [...new Set(transactions.map((tx) => (tx.paymentMethod && String(tx.paymentMethod).trim()) || t('transaction.other')).filter(Boolean))].sort(),
    [transactions, t]
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const cat = (tx.category && String(tx.category).trim()) || t('transaction.uncategorized');
      const pm = (tx.paymentMethod && String(tx.paymentMethod).trim()) || t('transaction.other');
      const catOk = selectedCategories.length === 0 || selectedCategories.includes(cat);
      const pmOk = selectedPayments.length === 0 || selectedPayments.includes(pm);
      return catOk && pmOk;
    });
  }, [transactions, selectedCategories, selectedPayments, t]);

  const toggleFilter = useCallback((kind) => {
    setActiveFilter((prev) => (prev === kind ? null : kind));
  }, []);

  const handleCategorySelect = useCallback((cat) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }, []);

  const handlePaymentSelect = useCallback((pm) => {
    setSelectedPayments((prev) =>
      prev.includes(pm) ? prev.filter((p) => p !== pm) : [...prev, pm]
    );
  }, []);

  const isCategoryFiltered = selectedCategories.length > 0 && selectedCategories.length < allCategories.length;
  const isPaymentFiltered = selectedPayments.length > 0 && selectedPayments.length < allPayments.length;

  if (loading) {
    return (
      <div className="table-wrapper">
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          {t('common.loadingDots')}
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="table-wrapper">
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          {t('transaction.noTransactions')}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrapper">
        <table>
          <colgroup>
            <col style={{ width: '16.67%' }} />
            <col style={{ width: '13.89%' }} />
            <col style={{ width: '18.06%' }} />
            <col style={{ width: '13.89%' }} />
            <col style={{ width: '18.06%' }} />
            <col style={{ width: '19.44%' }} />
          </colgroup>
          <thead>
            <tr>
              <th id="col-date">{t('transaction.tableDate')}</th>
              <th id="col-category">
                {t('transaction.tableCategory')}
                <button
                  ref={categoryBtnRef}
                  type="button"
                  className="th-filter-btn"
                  aria-label={t('transaction.filterCategoryAria')}
                  data-filter="category"
                  onClick={() => toggleFilter('category')}
                  style={{ color: isCategoryFiltered ? 'var(--color-primary)' : undefined }}
                >
                  <svg className="icon-filter" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                </button>
              </th>
              <th id="col-item">{t('transaction.tableItem')}</th>
              <th id="col-payment">
                {t('transaction.tablePayment')}
                <button
                  ref={paymentBtnRef}
                  type="button"
                  className="th-filter-btn"
                  aria-label={t('transaction.filterPaymentAria')}
                  data-filter="payment"
                  onClick={() => toggleFilter('payment')}
                  style={{ color: isPaymentFiltered ? 'var(--color-primary)' : undefined }}
                >
                  <svg className="icon-filter" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                </button>
              </th>
              <th id="col-amount">{t('transaction.tableAmount')}</th>
              <th id="col-actions" aria-label={t('transaction.tableActions')}></th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                onEdit={onEdit}
                onDelete={onDelete}
                onShowDetail={setDetailTx}
              />
            ))}
            {filteredTransactions.length === 0 && (
              <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                  {t('transaction.noFilterResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <FilterPopover
        anchorRef={categoryBtnRef}
        kind="category"
        items={allCategories}
        selected={selectedCategories}
        onSelect={handleCategorySelect}
        onSelectAll={() => setSelectedCategories([...allCategories])}
        onClearAll={() => setSelectedCategories([])}
        isOpen={activeFilter === 'category'}
        onClose={() => setActiveFilter(null)}
      />
      <FilterPopover
        anchorRef={paymentBtnRef}
        kind="payment"
        items={allPayments}
        selected={selectedPayments}
        onSelect={handlePaymentSelect}
        onSelectAll={() => setSelectedPayments([...allPayments])}
        onClearAll={() => setSelectedPayments([])}
        isOpen={activeFilter === 'payment'}
        onClose={() => setActiveFilter(null)}
      />

      <TransactionDetail
        transaction={detailTx}
        isOpen={!!detailTx}
        onClose={() => setDetailTx(null)}
      />
    </>
  );
}
