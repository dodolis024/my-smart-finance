import UserAvatar from '@/components/common/UserAvatar';

export default function TopBar({ streakBadge, onOpenSettings, onOpenChangelog }) {
  return (
    <header className="app-top-bar" aria-label="頂部導覽">
      <div className="app-top-bar__left">
        <UserAvatar variant="mobile" onOpenSettings={onOpenSettings} onOpenChangelog={onOpenChangelog} />
      </div>
      <div className="app-top-bar__right">
        {streakBadge}
      </div>
    </header>
  );
}
