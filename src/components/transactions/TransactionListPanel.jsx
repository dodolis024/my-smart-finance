import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TransactionDetail from './TransactionDetail';
import { useWindowSize } from '@/hooks/useWindowSize';
import { LAYOUT } from '@/lib/constants';
import { formatDateForDisplay } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

// 分類明細與信用卡彈窗共用的紀錄清單：排序列 + 清單 + 點進單筆詳情。
// 樣式沿用 category-detail-* 一套，兩邊外觀一致。
// sortBy 由外層彈窗持有：本元件會隨彈窗關閉一起卸載，排序偏好要跨開關保留就不能放這裡。
export default function TransactionListPanel({
  txs = [],
  isOpen,
  resetKey,
  sortBy = 'date',
  onSortChange,
  emptyText,
  onEdit,
  onDelete,
  onCloseParent,
}) {
  const { t } = useLanguage();
  const { formatTxAmount } = useDisplayAmount();
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const [detailTx, setDetailTx] = useState(null);

  // 關窗/換分類（換卡）時清掉，否則下次開窗會把上一筆的詳情一起帶出來
  useEffect(() => {
    setDetailTx(null);
  }, [isOpen, resetKey]);

  // 開/關內層 TransactionDetail 時，Modal 會無條件移除 body.modal-open，
  // 外層彈窗還開著時要補回，否則背景會變成可捲動。
  useEffect(() => {
    if (isOpen) document.body.classList.add('modal-open');
  }, [isOpen, resetKey, detailTx]);

  const listRef = useRef(null);
  const posRef = useRef(null);
  const datasetRef = useRef(null);

  const rows = useMemo(() => {
    // 日期新到舊；同日以 id 穩定排序，避免每次 render 順序跳動
    const byDate = (a, b) => {
      if (a.date === b.date) return String(b.id).localeCompare(String(a.id));
      return String(b.date).localeCompare(String(a.date));
    };
    if (sortBy === 'amount') {
      // 取絕對值，與圓餅圖切片大小的邏輯一致；同額再退回日期序
      return [...txs].sort((a, b) => {
        const diff = Math.abs(b.twdAmount || 0) - Math.abs(a.twdAmount || 0);
        return diff !== 0 ? diff : byDate(a, b);
      });
    }
    return [...txs].sort(byDate);
  }, [txs, sortBy]);

  // FLIP：先記住每列的舊位置，重排後把它從舊位置滑回新位置。
  // 讓人看得出是「同一批資料重新排隊」，而不是整份換掉。
  useLayoutEffect(() => {
    const el = listRef.current;
    const items = el ? [...el.children] : [];
    const next = new Map(items.map((li) => [li.dataset.txId, li.getBoundingClientRect().top]));
    const prev = posRef.current;
    const sameDataset = datasetRef.current === resetKey;
    posRef.current = next;
    datasetRef.current = resetKey;
    // 換一批資料（換分類／換卡）不是重排，別讓它滑
    if (!prev || !sameDataset) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    items.forEach((li) => {
      const before = prev.get(li.dataset.txId);
      const after = next.get(li.dataset.txId);
      if (before == null || Math.abs(before - after) < 1) return;
      if (typeof li.animate !== 'function') return;
      li.animate(
        [{ transform: `translateY(${before - after}px)` }, { transform: 'none' }],
        { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      );
    });
  }, [rows, resetKey]);

  return (
    <>
      {rows.length > 1 && onSortChange && (
        <div className="category-detail-sort">
          <span className="category-detail-sort__label">{t('dashboard.categoryDetailSortBy')}</span>
          {['date', 'amount'].map((key) => (
            <button
              key={key}
              type="button"
              className={`category-detail-sort__btn${sortBy === key ? ' is-active' : ''}`}
              aria-pressed={sortBy === key}
              onClick={() => onSortChange(key)}
            >
              {key === 'date' ? t('dashboard.categoryDetailSortDate') : t('dashboard.categoryDetailSortAmount')}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="category-detail-modal__empty">{emptyText}</p>
      ) : (
        <ul ref={listRef} className="category-detail-list">
          {rows.map((tx) => (
            <li
              key={tx.id}
              data-tx-id={tx.id}
              className="category-detail-row"
              role="button"
              tabIndex={0}
              onClick={() => setDetailTx(tx)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailTx(tx); } }}
            >
              <span className="category-detail-row__date">{formatDateForDisplay(tx.date, isMobile)}</span>
              <span className="category-detail-row__item">{tx.itemName}</span>
              <span className="category-detail-row__note">{tx.note}</span>
              <span className="category-detail-row__amount">{formatTxAmount(tx)}</span>
            </li>
          ))}
        </ul>
      )}

      <TransactionDetail
        transaction={detailTx}
        isOpen={!!detailTx}
        onClose={() => setDetailTx(null)}
        // 編輯要捲到下方表單，但 body.modal-open 會鎖住捲動 → 兩層彈窗都得先關掉
        onEdit={onEdit ? (tx) => { setDetailTx(null); onCloseParent?.(); onEdit(tx); } : undefined}
        // 刪除後這份明細快照就過期了，跟換月一樣直接關窗
        onDelete={onDelete ? async (tx) => { if (await onDelete(tx.id)) { setDetailTx(null); onCloseParent?.(); } } : undefined}
      />
    </>
  );
}
