export default function StreakBadge({ streakState, onClick }) {
  const count = streakState?.count || 0;
  let icon;
  if (streakState?.broken) {
    icon = <span className="streak-badge__icon" aria-hidden="true">😡</span>;
  } else if (count > 0) {
    icon = (
      <span className="streak-badge__icon" aria-hidden="true">
        <svg className="icon-fire" aria-hidden="true" width="16" height="16">
          <use href="#icon-fire" />
        </svg>
      </span>
    );
  } else {
    icon = <span className="streak-badge__icon" aria-hidden="true">✨</span>;
  }

  return (
    <button
      type="button"
      className="streak-badge"
      aria-label="查看連續記錄狀態"
      onClick={onClick}
    >
      {icon}
      <span className="streak-badge__count">{count}</span>
      <span className="streak-badge__unit">天</span>
    </button>
  );
}
