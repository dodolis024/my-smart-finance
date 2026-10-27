import { useState, useEffect } from 'react';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { fetchTransactionMatches } from '@/hooks/useTransactionSearch';
import { formatOriginalMoney } from '@/lib/utils';
import { formatTripRange } from '@/lib/trips';

const SEARCH_LIMIT = 30;

/**
 * 一趟旅程的明細：日期範圍內每一筆可以排除／加回，手動加入的可以移除；
 * 下方搜尋日期範圍外的交易加進來（例如出發前訂的機票）。
 */
export default function TripDetailModal({ userId, summary, currentYear, onClose, onEntry, onEdit, onDelete }) {
  const { t, lang } = useLanguage();
  const { toDisplay, formatTotal } = useDisplayAmount();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const tripId = summary?.trip.id;

  useEffect(() => {
    setQuery('');
    setResults(null);
  }, [tripId]);

  if (!summary) return null;
  const { trip, entries, total, count, excludedCount } = summary;
  const inTrip = new Set(entries.filter((e) => e.status === 'in' || e.status === 'added').map((e) => e.tx.id));

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const { rows, error } = await fetchTransactionMatches(userId, query, { limit: SEARCH_LIMIT });
      setResults(error ? 'failed' : rows.filter((tx) => tx.type !== 'income'));
    } catch {
      setResults('failed');
    } finally {
      setSearching(false);
    }
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

  return (
    <Modal isOpen={!!summary} onClose={onClose} className="category-detail-modal" titleId="trip-detail-title">
      <div className="category-detail-modal__backdrop" onClick={onClose} />
      <div className="category-detail-modal__dialog scrollbar-on-scroll analysis-trip-detail" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="trip-detail-title" className="category-detail-modal__title">{trip.name}</h2>

        <div className="analysis-trip-detail__summary">
          <span className="category-detail-modal__total">{formatTotal(total)}</span>
          <span className="category-detail-modal__meta">
            {t('spendingAnalysis.trips.meta', { range: formatTripRange(trip.start, trip.end, currentYear), count })}
            {excludedCount > 0 && t('spendingAnalysis.trips.metaExcluded', { count: excludedCount })}
          </span>
          <span className="analysis-trip-detail__actions">
            <button type="button" className="analysis-link" onClick={() => onEdit(trip)}>{t('spendingAnalysis.tripDetail.edit')}</button>
            <button type="button" className="analysis-link analysis-link--muted" onClick={() => onDelete(trip)}>{t('spendingAnalysis.tripDetail.delete')}</button>
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="analysis-empty">{t('spendingAnalysis.tripDetail.empty')}</p>
        ) : (
          <ul className="analysis-trip-detail__list">
            {entries.map((entry) => {
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
            })}
          </ul>
        )}

        <h3 className="analysis-trip-detail__add-title">{t('spendingAnalysis.tripDetail.addTitle')}</h3>
        <p className="analysis-trip-form__note">{t('spendingAnalysis.tripDetail.addHint')}</p>
        <form className="analysis-trip-detail__search" onSubmit={handleSearch}>
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
              {results.map((tx) => (
                <li key={tx.id} className="analysis-trip-entry">
                  <span className="analysis-trip-entry__date">{tx.date.slice(0, 4) === String(currentYear) ? dateOf(tx) : tx.date.replaceAll('-', '/')}</span>
                  <span className="analysis-trip-entry__name">
                    {tx.itemName}
                    {tx.category && <span className="analysis-trip-entry__cat">{sep}{tx.category}</span>}
                  </span>
                  <span className="analysis-trip-entry__original">{original(tx)}</span>
                  <span className="analysis-trip-entry__amount">{formatTotal(toDisplay(tx).value)}</span>
                  {inTrip.has(tx.id) ? (
                    <span className="analysis-trip-entry__state">{t('spendingAnalysis.tripDetail.alreadyIn')}</span>
                  ) : (
                    <button type="button" className="analysis-btn analysis-btn--small" onClick={() => onEntry(trip.id, tx.id, 'add')}>
                      {t('spendingAnalysis.tripDetail.add')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </Modal>
  );
}
