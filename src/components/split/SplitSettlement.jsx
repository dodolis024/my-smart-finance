import { useState } from 'react';

export default function SplitSettlement({ transactions, currency, onSettle, settlementHistory, onDeleteSettlement }) {
  const [showHistory, setShowHistory] = useState(false);
  const cur = currency || 'TWD';
  const ZERO_DECIMAL = new Set(['TWD', 'JPY', 'KRW', 'VND']);
  const fmtAmt = (amt, c = cur) => {
    const d = ZERO_DECIMAL.has(c) ? 0 : 2;
    const rounded = Number(amt.toFixed(d));
    return rounded.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  return (
    <div className="split-settlement">
      {!transactions?.length ? (
        <p className="split-settlement__empty">目前帳已結清 🎉</p>
      ) : (
        transactions.map((t, i) => (
          <div key={i} className="split-settlement__row">
            <div className="split-settlement__info">
              <span className="split-settlement__from">{t.from}</span>
              <span className="split-settlement__arrow">→</span>
              <span className="split-settlement__to">{t.to}</span>
              <span className="split-settlement__amount">{cur} {fmtAmt(t.amount)}</span>
            </div>
            {onSettle && (
              <button
                type="button"
                className="split-settlement__settle-btn"
                onClick={() => onSettle(t)}
              >
                已還清
              </button>
            )}
          </div>
        ))
      )}

      {/* 還款紀錄 */}
      {settlementHistory?.length > 0 && (
        <>
          <button
            type="button"
            className="split-settlement__history-toggle"
            onClick={() => setShowHistory(prev => !prev)}
          >
            {showHistory ? '隱藏還款紀錄' : `查看還款紀錄（${settlementHistory.length}）`}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className={`split-settlement__history-chevron${showHistory ? ' is-open' : ''}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {showHistory && (
            <div className="split-settlement__history">
              {settlementHistory.map(s => (
                <div key={s.id} className="split-settlement__history-row">
                  <div className="split-settlement__history-info">
                    <span className="split-settlement__from">{s.fromName}</span>
                    <span className="split-settlement__arrow">→</span>
                    <span className="split-settlement__to">{s.toName}</span>
                    <span className="split-settlement__amount">{s.currency || cur} {fmtAmt(Number(s.amount), s.currency || cur)}</span>
                  </div>
                  <div className="split-settlement__history-actions">
                    <span className="split-settlement__history-date">
                      {s.date}
                    </span>
                    {onDeleteSettlement && (
                      <button
                        type="button"
                        className="split-settlement__history-delete"
                        onClick={() => onDeleteSettlement(s.id)}
                        aria-label="撤銷"
                        title="撤銷此還款"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
