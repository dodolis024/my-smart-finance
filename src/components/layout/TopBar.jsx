import UserAvatar from '@/components/common/UserAvatar';

export default function TopBar({ streakBadge, onOpenSettings, onOpenReminder, onOpenChangelog }) {
  return (
    <header className="app-top-bar" aria-label="頂部導覽">
      <div className="app-top-bar__left">
        <UserAvatar variant="mobile" onOpenSettings={onOpenSettings} onOpenReminder={onOpenReminder} onOpenChangelog={onOpenChangelog} />
      </div>
      <div className="app-top-bar__right">
        {streakBadge}
      </div>
    </header>
  );
}
