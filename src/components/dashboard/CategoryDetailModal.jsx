import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import TransactionDetail from '@/components/transactions/TransactionDetail';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useWindowSize } from '@/hooks/useWindowSize';
import { LAYOUT } from '@/lib/constants';
import { formatMoney, formatDateForDisplay } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export default function CategoryDetailModal({ isOpen, onClose, category }) {
  const { t } = useLanguage();
  const dialogRef = useRef(null);
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const [detailTx, setDetailTx] = useState(null);
  useScrollbarOnScroll(dialogRef, isOpen && !!category);

  // 本元件靠 `return null` 隱藏，不會被卸載 → detailTx 會跨越開關存活。
  // 關窗/換分類時清掉，否則下次開窗會把上一筆的詳情一起帶出來。
  useEffect(() => {
    setDetailTx(null);
  }, [isOpen, category]);

  // 開/關內層 TransactionDetail 時，Modal 會無條件移除 body.modal-open
  //（它內部的 SplitShareDetailModal 以 isOpen=false 掛載也會觸發 else 分支），
  // 外層彈窗還開著時要補回，否則背景會變成可捲動。
  useEffect(() => {
    if (isOpen && category) document.body.classList.add('modal-open');
  }, [isOpen, category, detailTx]);

  const rows = useMemo(() => {
    if (!category?.txs) return [];
    // 日期新到舊；同日以 id 穩定排序，避免每次 render 順序跳動
    return [...category.txs].sort((a, b) => {
      if (a.date === b.date) return String(b.id).localeCompare(String(a.id));
      return String(b.date).localeCompare(String(a.date));
    });
  }, [category]);

  if (!category) return null;

  const total = Math.abs(category.value);
  const share = category.totalExpense > 0 ? (total / category.totalExpense) * 100 : 0;
  const shareText = share % 1 === 0 ? String(Math.round(share)) : share.toFixed(1);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} className="category-detail-modal" titleId="category-detail-modal-title">
        <div className="category-detail-modal__backdrop" onClick={onClose} />
        <div ref={dialogRef} className="category-detail-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
          <h2 id="category-detail-modal-title" className="category-detail-modal__title">{category.label}</h2>

          <div className="category-detail-modal__summary">
            <span className="category-detail-modal__total">{formatMoney(category.value)}</span>
            <span className="category-detail-modal__meta">
              {t('dashboard.categoryDetailCount', { count: rows.length })}
              {' · '}
              {t('dashboard.categoryDetailShare', { percent: shareText })}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="category-detail-modal__empty">{t('dashboard.categoryDetailEmpty')}</p>
          ) : (
            <ul className="category-detail-list">
              {rows.map((tx) => (
                <li
                  key={tx.id}
                  className="category-detail-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailTx(tx)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailTx(tx); } }}
                >
                  <span className="category-detail-row__date">{formatDateForDisplay(tx.date, isMobile)}</span>
                  <span className="category-detail-row__item">{tx.itemName}</span>
                  <span className="category-detail-row__note">{tx.note}</span>
                  <span className="category-detail-row__amount">{formatMoney(tx.twdAmount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <TransactionDetail
        transaction={detailTx}
        isOpen={!!detailTx}
        onClose={() => setDetailTx(null)}
      />
    </>
  );
}
