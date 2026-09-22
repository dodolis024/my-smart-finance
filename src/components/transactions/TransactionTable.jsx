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

  // 以整份清單（不是當頁）判斷：翻頁時日期格式與欄寬不會跳來跳去
  const singleYear = useMemo(
    () => new Set(transactions.map((tx) => String(tx.date).slice(0, 4))).size <= 1,
    [transactions]
  );

  // 分組時日期由每日標題標示，整個日期欄不存在，寬度分給其他欄；
  // 年檢視不分組，日期回到每一列自己顯示。
  // 操作欄固定成剛好放得下編輯＋刪除（36 + 8 + 36 + 左右內距 20 = 100px，留 4px 餘裕）；
  // 金額欄固定成放得下原幣模式的長金額（US$12,345.67：>1440px 字級 15px 約 102px + 左右內距 24px = 126px），
  // 兩種金額模式共用同一組欄寬，切換時欄位不會移動。
  // 品項欄不給寬度、吃掉剩下的空間：只有品項名稱長短說不準，寬螢幕多出來的留白都給它。
  // 分類欄 20%：最擠的是 1201～1300px（側邊欄＋雙欄，表格只有約 540～590px），
  // 15% 時 1280px 連五個字的自訂分類都會被截，20% 剛好放得下五個中文字。
  // 年檢視的日期欄改固定寬：原本 16.67% 在寬螢幕留一大片白、1201px 卻連日期都被截。
  // 整張表同一年時省略年份（09-22：>1440px 字級 15px 約 43px + 左右內距 28px = 71px → 4.75rem）；
  // 搜尋結果會跨年，此時保留完整日期（2026-09-22 約 86px + 28px = 114px → 7.25rem）
  const colgroup = groupByDate ? (
    <colgroup>
      <col style={{ width: '20%' }} />
      <col />
      <col style={{ width: '16%' }} />
      <col style={{ width: '8rem' }} />
      <col style={{ width: '6.5rem' }} />
    </colgroup>
  ) : (
    <colgroup>
      <col style={{ width: singleYear ? '4.75rem' : '7.25rem' }} />
      <col style={{ width: '20%' }} />
      <col />
      <col style={{ width: '13.89%' }} />
      <col style={{ width: '8rem' }} />
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
                  shortDate={singleYear}
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
