import { useState, useMemo } from 'react';
import TransactionRow from './TransactionRow';
import TransactionDayGroup from './TransactionDayGroup';
import TransactionDetail from './TransactionDetail';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { useWindowSize } from '@/hooks/useWindowSize';
import { LAYOUT } from '@/lib/constants';

/**
 * 交易列表。篩選由上層負責（篩選鈕住在區塊標題列），這裡只管分頁與呈現。
 *
 * groupByDate 打開時，每一天是「卡片外的標題 ＋ 一張交易卡片」；
 * 年檢視關掉分組，退回單一張表格、日期回到每一列自己顯示。
 */
export default function TransactionTable({
  transactions = [],
  onEdit,
  onDelete,
  loading,
  emptyMessage,
  periodName,
  page = 1,
  pageSize,
  groupByDate = true,
  categoryColors,
}) {
  const { t } = useLanguage();
  const { toDisplay } = useDisplayAmount();
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const [detailTx, setDetailTx] = useState(null);

  const pagedTransactions = useMemo(
    () => (pageSize ? transactions.slice((page - 1) * pageSize, page * pageSize) : transactions),
    [transactions, page, pageSize]
  );

  // 當日合計刻意算在分頁前：同一天被分頁切開時，兩頁的標題顯示同一個總額，
  // 而不是各自當頁的部分和。金額換成顯示幣別
  const dayTotals = useMemo(() => {
    const totals = new Map();
    for (const tx of transactions) {
      const acc = totals.get(tx.date) || { count: 0, expense: 0, income: 0 };
      acc.count += 1;
      const { value } = toDisplay(tx);
      if (tx.type === 'income') {
        acc.income += value;
      } else {
        acc.expense += value;
      }
      totals.set(tx.date, acc);
    }
    return totals;
  }, [transactions, toDisplay]);

  // 當頁依日期切成一天一組；交錯底色在每張卡片內重新起算
  const days = useMemo(() => {
    if (!groupByDate) return [];
    const out = [];
    let current = null;
    for (const tx of pagedTransactions) {
      if (!current || current.date !== tx.date) {
        const totals = dayTotals.get(tx.date) || { count: 0, expense: 0, income: 0 };
        current = {
          date: tx.date,
          count: totals.count,
          expense: totals.expense,
          income: totals.income,
          rows: [],
        };
        out.push(current);
      }
      current.rows.push({ tx, isAlt: current.rows.length % 2 === 1 });
    }
    return out;
  }, [groupByDate, pagedTransactions, dayTotals]);

  // 分組時日期由每日標題標示，整個日期欄不存在，寬度分給其他欄；
  // 年檢視不分組，日期回到每一列自己顯示，欄位與原本的寬度一起還原。
  // 操作欄固定成剛好放得下編輯＋刪除（36 + 8 + 36 + 左右內距 20 = 100px，留 4px 餘裕），
  // 金額欄不給寬度、吃掉剩下的空間：寬螢幕上操作欄原本多出來的留白都讓給金額，
  // 原幣模式的長金額（US$1,234.56）才放得下。兩種金額模式共用同一組欄寬，切換時欄位不會移動
  const colgroup = groupByDate ? (
    <colgroup>
      <col style={{ width: '15%' }} />
      <col style={{ width: '32%' }} />
      <col style={{ width: '16%' }} />
      <col />
      <col style={{ width: '6.5rem' }} />
    </colgroup>
  ) : (
    <colgroup>
      <col style={{ width: '16.67%' }} />
      <col style={{ width: '13.89%' }} />
      <col style={{ width: '18.06%' }} />
      <col style={{ width: '13.89%' }} />
      <col />
      <col style={{ width: '6.5rem' }} />
    </colgroup>
  );

  const detailModal = (
    <TransactionDetail
      transaction={detailTx}
      isOpen={!!detailTx}
      onClose={() => setDetailTx(null)}
      onEdit={onEdit ? (tx) => { setDetailTx(null); onEdit(tx); } : undefined}
      onDelete={onDelete ? async (tx) => { if (await onDelete(tx.id)) setDetailTx(null); } : undefined}
    />
  );

  if (loading) {
    return (
      <div className="table-wrapper">
        <div className="transaction-list-placeholder">{t('common.loadingDots')}</div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="table-wrapper">
        <div className="transaction-list-placeholder transaction-list-placeholder--empty">
          {emptyMessage || t('transaction.noTransactions', { period: periodName })}
        </div>
      </div>
    );
  }

  return (
    <>
      {groupByDate ? (
        <div className={`tx-day-list${isMobile ? ' tx-day-list--mobile' : ''}`}>
          {days.map((day) => (
            <TransactionDayGroup
              key={day.date}
              day={day}
              isMobile={isMobile}
              colgroup={colgroup}
              categoryColors={categoryColors}
              onEdit={onEdit}
              onDelete={onDelete}
              onShowDetail={setDetailTx}
            />
          ))}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            {colgroup}
            <tbody>
              {pagedTransactions.map((tx, index) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  isAlt={index % 2 === 1}
                  showDate
                  categoryColors={categoryColors}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onShowDetail={setDetailTx}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailModal}
    </>
  );
}
