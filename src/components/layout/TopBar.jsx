import UserAvatar from '@/components/common/UserAvatar';

export default function TopBar({ streakBadge, onOpenSettings, onOpenChangelog, onOpenSplit }) {
  return (
    <header className="app-top-bar" aria-label="頂部導覽">
      <div className="app-top-bar__left">
        <UserAvatar variant="mobile" onOpenSettings={onOpenSettings} onOpenChangelog={onOpenChangelog} />
      </div>
      <div className="app-top-bar__right">
        <button
          type="button"
          className="split-entry-btn"
          onClick={onOpenSplit}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.499 11.998h15m-7.5-6.75h.008v.008h-.008v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM12 18.751h.007v.007H12v-.007Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <span>分帳</span>
        </button>
        {streakBadge}
      </div>
    </header>
  );
}
