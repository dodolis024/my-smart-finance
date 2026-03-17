export default function SplitSettlement({ transactions, currency }) {
  if (!transactions?.length) {
    return (
      <div className="split-settlement">
        <p className="split-settlement__title">結算</p>
        <p className="split-settlement__empty">目前帳已結清 🎉</p>
      </div>
    );
  }

  return (
    <div className="split-settlement">
      <p className="split-settlement__title">結算</p>
      {transactions.map((t, i) => (
        <div key={i} className="split-settlement__row">
          <span className="split-settlement__from">{t.from}</span>
          <span className="split-settlement__arrow">→</span>
          <span className="split-settlement__to">{t.to}</span>
          <span className="split-settlement__amount">
            {currency || 'TWD'} {t.amount % 1 === 0 ? t.amount.toLocaleString() : t.amount.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}
