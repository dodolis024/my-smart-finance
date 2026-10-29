import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { fetchTripAddCandidates } from '@/hooks/useTransactionSearch';
import { useSettings } from '@/hooks/useSettings';
import { formatOriginalMoney } from '@/lib/utils';
import { formatTripRange } from '@/lib/trips';

const SEARCH_LIMIT = 30;
// App 預設分類裡的「旅遊」（中、英文帳號各自的預設名稱）：使用者有這個分類，加入區就先選它
const TRAVEL_CATEGORIES = ['旅遊', 'Travel'];

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
  </svg>
);

const DeleteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);

const isOut = (entry) => entry.status === 'excluded' || entry.status === 'fixed';

/**
 * 一趟旅程的明細：日期範圍內每一筆可以排除／加回，手動加入的可以移除；排除的接在同一個清單最下面，預設摺起來。
 * 下方搜尋日期範圍外的交易加進來（例如出發前訂的機票）；已經算在別趟旅程的不能加，免得悄悄從那趟被搶走。
 * 搜尋可以先選分類：有「旅遊」分類的使用者一打開就列出出發前的旅遊交易，不用自己想關鍵字。
 */
export default function TripDetailModal({ userId, summary, tripOf, currentYear, onClose, onEntry, onEdit, onDelete }) {
  const { t, lang } = useLanguage();
  const { toDisplay, formatTotal } = useDisplayAmount();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [category, setCategory] = useState('');
  const { expenseCategories, loadSettingsData } = useSettings();
  const searchRequestRef = useRef(0);
  const tripId = summary?.trip.id;
  const tripStart = summary?.trip.start;
  const travelCategory = expenseCategories.find((name) => TRAVEL_CATEGORIES.includes(name)) || '';

  useEffect(() => {
    if (tripId) loadSettingsData();
  }, [tripId, loadSettingsData]);

  const runSearch = async (nextQuery, nextCategory) => {
    const reqId = ++searchRequestRef.current;
    if (!nextQuery.trim() && !nextCategory) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const { rows, error } = await fetchTripAddCandidates(userId, {
        query: nextQuery, category: nextCategory, before: tripStart, limit: SEARCH_LIMIT,
      });
      // 連續換分類時，只採用最後一次的結果
      if (reqId === searchRequestRef.current) setResults(error ? 'failed' : rows);
    } catch {
      if (reqId === searchRequestRef.current) setResults('failed');
    } finally {
      if (reqId === searchRequestRef.current) setSearching(false);
    }
  };

  // 換一趟旅程（或分類清單剛讀到）：清掉搜尋，有「旅遊」分類就先列出出發前的旅遊交易
  useEffect(() => {
    setQuery('');
    setResults(null);
    setShowExcluded(false);
    setCategory(travelCategory);
    if (tripId && travelCategory) runSearch('', travelCategory);
  }, [tripId, travelCategory]); // eslint-disable-line react-hooks/exhaustive-deps -- runSearch 每次重繪都是新的，只在換旅程時跑

  if (!summary) return null;
  const { trip, entries, total, count } = summary;
  const shown = entries.filter((e) => !isOut(e));
  const excluded = entries.filter(isOut);
  const inTrip = new Set(entries.filter((e) => e.status === 'in' || e.status === 'added').map((e) => e.tx.id));

  const handleSearch = (e) => {
    e.preventDefault();
    runSearch(query, category);
  };

  const handleCategoryChange = (e) => {
    setCategory(e.target.value);
    runSearch(query, e.target.value);
  };

  const dateOf = (tx) => {
    const [, m, d] = tx.date.split('-').map(Number);
    return `${m}/${d}`;
  };
  const original = (tx) => (tx.currency && tx.currency !== 'TWD' && tx.originalAmount != null
    ? formatOriginalMoney(tx.originalAmount, tx.currency)
    : '');
  const sep = lang === 'en' ? ' · ' : '・';

  const stateLabel = (entry) => {
    if (entry.status === 'excluded') return t('spendingAnalysis.tripDetail.excluded');
    if (entry.status === 'fixed') return t('spendingAnalysis.tripDetail.fixed');
    if (entry.status === 'added') return t('spendingAnalysis.tripDetail.added');
    if (entry.status === 'other') return t('spendingAnalysis.tripDetail.other', { name: entry.otherTrip.name });
    return null;
  };
  const action = (entry) => {
    if (entry.status === 'in') return ['exclude', t('spendingAnalysis.tripDetail.exclude')];
    if (entry.status === 'excluded' || entry.status === 'fixed') return ['restore', t('spendingAnalysis.tripDetail.restore')];
    if (entry.status === 'added') return ['remove', t('spendingAnalysis.tripDetail.remove')];
    return null;
  };

  const renderEntry = (entry) => {
    const { tx } = entry;
    const counted = entry.status === 'in' || entry.status === 'added';
    const label = stateLabel(entry);
    const act = action(entry);
    return (
      <li key={tx.id} className={`analysis-trip-entry${counted ? '' : ' is-out'}`}>
        <span className="analysis-trip-entry__date">{dateOf(tx)}</span>
        <span className="analysis-trip-entry__name">
          {tx.itemName}
          {tx.category && <span className="analysis-trip-entry__cat">{sep}{tx.category}</span>}
          {label && <span className="analysis-trip-entry__state">{label}</span>}
        </span>
        <span className="analysis-trip-entry__original">{original(tx)}</span>
        <span className="analysis-trip-entry__amount">{formatTotal(toDisplay(tx).value)}</span>
        {act ? (
          <button type="button" className="analysis-btn analysis-btn--small" onClick={() => onEntry(trip.id, tx.id, act[0])}>
            {act[1]}
          </button>
        ) : <span />}
      </li>
    );
  };

  return (
    <Modal isOpen={!!summary} onClose={onClose} className="category-detail-modal" titleId="trip-detail-title">
      <div className="category-detail-modal__backdrop" onClick={onClose} />
      <div className="category-detail-modal__dialog scrollbar-on-scroll analysis-trip-detail" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <div className="analysis-trip-detail__head">
          <h2 id="trip-detail-title" className="category-detail-modal__title">{trip.name}</h2>
          <button
            type="button"
            className="analysis-icon-btn"
            aria-label={t('spendingAnalysis.tripDetail.edit')}
            title={t('spendingAnalysis.tripDetail.edit')}
            onClick={() => onEdit(trip)}
          >
            <EditIcon />
          </button>
          <button
            type="button"
            className="analysis-icon-btn"
            aria-label={t('spendingAnalysis.tripDetail.delete')}
            title={t('spendingAnalysis.tripDetail.delete')}
            onClick={() => onDelete(trip)}
          >
            <DeleteIcon />
          </button>
        </div>

        <div className="analysis-trip-detail__summary">
          <span className="category-detail-modal__total">{formatTotal(total)}</span>
          <span className="category-detail-modal__meta">
            {t('spendingAnalysis.trips.meta', { range: formatTripRange(trip.start, trip.end, currentYear), count })}
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="analysis-empty">{t('spendingAnalysis.tripDetail.empty')}</p>
        ) : (
          <ul className="analysis-trip-detail__list">
            {shown.map(renderEntry)}
            {excluded.length > 0 && (
              <li className="analysis-trip-detail__toggle-row">
                <button
                  type="button"
                  className="analysis-trip-detail__toggle"
                  aria-expanded={showExcluded}
                  onClick={() => setShowExcluded((v) => !v)}
                >
                  <span className={`analysis-trip-detail__chevron${showExcluded ? ' is-open' : ''}`} aria-hidden="true">›</span>
                  {t('spendingAnalysis.tripDetail.excludedGroup', { count: excluded.length })}
                </button>
              </li>
            )}
            {showExcluded && excluded.map(renderEntry)}
          </ul>
        )}

        <h3 className="analysis-trip-detail__add-title">{t('spendingAnalysis.tripDetail.addTitle')}</h3>
        <form className="analysis-trip-detail__search" onSubmit={handleSearch}>
          <select
            className="analysis-input analysis-trip-detail__category"
            value={category}
            onChange={handleCategoryChange}
            aria-label={t('spendingAnalysis.tripDetail.category')}
          >
            <option value="">{t('spendingAnalysis.tripDetail.allCategories')}</option>
            {expenseCategories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input
            className="analysis-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('spendingAnalysis.tripDetail.searchPlaceholder')}
          />
          <button type="submit" className="analysis-btn" disabled={searching}>{t('spendingAnalysis.tripDetail.search')}</button>
        </form>
        {results === 'failed' && <p className="analysis-empty">{t('spendingAnalysis.tripDetail.searchFailed')}</p>}
        {Array.isArray(results) && (
          results.length === 0 ? (
            <p className="analysis-empty">{t('spendingAnalysis.tripDetail.noResults')}</p>
          ) : (
            <ul className="analysis-trip-detail__list">
              {results.map((tx) => {
                // 已經算在別趟旅程的不能加；要改算到這趟，先到那趟排除或移除。旅程名稱可能很長，寫在名稱後面
                const owner = tripOf?.get(tx.id);
                const otherTrip = owner && owner.id !== trip.id && !inTrip.has(tx.id) ? owner : null;
                return (
                  <li key={tx.id} className="analysis-trip-entry">
                    <span className="analysis-trip-entry__date">{tx.date.slice(0, 4) === String(currentYear) ? dateOf(tx) : tx.date.replaceAll('-', '/')}</span>
                    <span className="analysis-trip-entry__name">
                      {tx.itemName}
                      {tx.category && <span className="analysis-trip-entry__cat">{sep}{tx.category}</span>}
                      {otherTrip && <span className="analysis-trip-entry__state">{t('spendingAnalysis.tripDetail.other', { name: otherTrip.name })}</span>}
                    </span>
                    <span className="analysis-trip-entry__original">{original(tx)}</span>
                    <span className="analysis-trip-entry__amount">{formatTotal(toDisplay(tx).value)}</span>
                    {inTrip.has(tx.id) ? (
                      <span className="analysis-trip-entry__state">{t('spendingAnalysis.tripDetail.alreadyIn')}</span>
                    ) : otherTrip ? <span /> : (
                      <button type="button" className="analysis-btn analysis-btn--small" onClick={() => onEntry(trip.id, tx.id, 'add')}>
                        {t('spendingAnalysis.tripDetail.add')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    </Modal>
  );
}
