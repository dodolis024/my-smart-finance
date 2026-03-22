import { useTheme } from '../../hooks/useTheme.js';

export default function StreakBadge({ streakState, onClick }) {
  const { theme } = useTheme();
  const count = streakState?.count || 0;
  const totalDays = streakState?.totalDays ?? 0;
  const isNewUser = totalDays === 0;
  let icon;
  if (streakState?.broken && !isNewUser) {
    icon = <span className="streak-badge__icon" aria-hidden="true">😡</span>;
  } else if (count > 0) {
    icon = theme === 'dawn' ? (
      <span className="streak-badge__icon" aria-hidden="true">
        <svg className="icon-diamond" aria-hidden="true" width="16" height="16">
          <use href="#icon-diamond" />
        </svg>
      </span>
    ) : (
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
