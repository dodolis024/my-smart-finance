import { useState, useMemo, useRef, useCallback } from 'react';
import TransactionRow from './TransactionRow';
import FilterPopover from './FilterPopover';
import TransactionDetail from './TransactionDetail';

export default function TransactionTable({ transactions = [], onEdit, onDelete, loading }) {
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [activeFilter, setActiveFilter] = useState(null);
  const [detailTx, setDetailTx] = useState(null);

  const categoryBtnRef = useRef(null);
  const paymentBtnRef = useRef(null);

  const allCategories = useMemo(
    () => [...new Set(transactions.map((t) => (t.category && String(t.category).trim()) || '未分類').filter(Boolean))].sort(),
    [transactions]
  );

  const allPayments = useMemo(
    () => [...new Set(transactions.map((t) => (t.paymentMethod && String(t.paymentMethod).trim()) || '其他').filter(Boolean))].sort(),
    [transactions]
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const cat = (tx.category && String(tx.category).trim()) || '未分類';
      const pm = (tx.paymentMethod && String(tx.paymentMethod).trim()) || '其他';
      const catOk = selectedCategories.length === 0 || selectedCategories.includes(cat);
      const pmOk = selectedPayments.length === 0 || selectedPayments.includes(pm);
      return catOk && pmOk;
    });
  }, [transactions, selectedCategories, selectedPayments]);

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
          載入中...
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="table-wrapper">
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          本月尚無交易記錄
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th id="col-date">日期</th>
              <th id="col-category">
                分類
                <button
                  ref={categoryBtnRef}
                  type="button"
                  className="th-filter-btn"
                  aria-label="篩選分類"
                  data-filter="category"
                  onClick={() => toggleFilter('category')}
                  style={{ color: isCategoryFiltered ? 'var(--color-primary)' : undefined }}
                >
                  <svg className="icon-filter" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                </button>
              </th>
              <th id="col-item">項目</th>
              <th id="col-payment">
                支付方式
                <button
                  ref={paymentBtnRef}
                  type="button"
                  className="th-filter-btn"
                  aria-label="篩選支付方式"
                  data-filter="payment"
                  onClick={() => toggleFilter('payment')}
                  style={{ color: isPaymentFiltered ? 'var(--color-primary)' : undefined }}
                >
                  <svg className="icon-filter" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                </button>
              </th>
              <th id="col-amount">金額</th>
              <th id="col-actions">操作</th>
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
                  無符合篩選條件的交易
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
