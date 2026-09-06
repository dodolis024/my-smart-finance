import { useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 交易列表的分類 / 支付方式篩選。
 *
 * 篩選鈕住在區塊標題列（不再是表頭的一部分），狀態因此不能留在表格裡。
 * 抽成 hook 讓 DashboardPage 與測試共用同一份實作，接線才不會跟測試各寫一套。
 *
 * 篩選一律套在分頁之前：先切片再篩選會讓「篩選 + 翻頁」出現空白頁。
 *
 * @param {Array} rows 目前期間（或搜尋結果）的完整交易陣列
 * @param {Function} [onChange] 篩選被使用者改動時呼叫（用來回第 1 頁）
 */
export function useTransactionFilters(rows, onChange) {
  const { t } = useLanguage();
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [activeFilter, setActiveFilter] = useState(null);

  const categoryOf = useCallback(
    (tx) => (tx.category && String(tx.category).trim()) || t('transaction.uncategorized'),
    [t]
  );
  const paymentOf = useCallback(
    (tx) => (tx.paymentMethod && String(tx.paymentMethod).trim()) || t('transaction.other'),
    [t]
  );

  const allCategories = useMemo(
    () => [...new Set(rows.map(categoryOf))].sort(),
    [rows, categoryOf]
  );
  const allPayments = useMemo(
    () => [...new Set(rows.map(paymentOf))].sort(),
    [rows, paymentOf]
  );

  const filteredRows = useMemo(() => {
    if (selectedCategories.length === 0 && selectedPayments.length === 0) return rows;
    return rows.filter(
      (tx) =>
        (selectedCategories.length === 0 || selectedCategories.includes(categoryOf(tx))) &&
        (selectedPayments.length === 0 || selectedPayments.includes(paymentOf(tx)))
    );
  }, [rows, selectedCategories, selectedPayments, categoryOf, paymentOf]);

  const notify = useCallback(() => { onChange?.(); }, [onChange]);

  const toggleFilter = useCallback(() => {
    setActiveFilter((prev) => (prev ? null : 'all'));
  }, []);
  const closeFilter = useCallback(() => setActiveFilter(null), []);

  const sections = useMemo(
    () => [
      {
        key: 'category',
        title: t('transaction.tableCategory'),
        items: allCategories,
        selected: selectedCategories,
        onSelect: (cat) => {
          setSelectedCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
          notify();
        },
        onSelectAll: () => { setSelectedCategories([...allCategories]); notify(); },
        onClearAll: () => { setSelectedCategories([]); notify(); },
      },
      {
        key: 'payment',
        title: t('transaction.tablePayment'),
        items: allPayments,
        selected: selectedPayments,
        onSelect: (pm) => {
          setSelectedPayments((prev) => (prev.includes(pm) ? prev.filter((p) => p !== pm) : [...prev, pm]));
          notify();
        },
        onSelectAll: () => { setSelectedPayments([...allPayments]); notify(); },
        onClearAll: () => { setSelectedPayments([]); notify(); },
      },
    ],
    [t, allCategories, allPayments, selectedCategories, selectedPayments, notify]
  );

  // 全選等同沒篩選，不該讓漏斗鈕亮起來
  const isFiltered =
    (selectedCategories.length > 0 && selectedCategories.length < allCategories.length) ||
    (selectedPayments.length > 0 && selectedPayments.length < allPayments.length);

  return { filteredRows, sections, activeFilter, toggleFilter, closeFilter, isFiltered };
}
