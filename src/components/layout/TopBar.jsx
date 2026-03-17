import UserAvatar from '@/components/common/UserAvatar';

export default function TopBar({ streakBadge }) {
  return (
    <header className="app-top-bar" aria-label="頂部導覽">
      <div className="app-top-bar__left">
        <UserAvatar variant="mobile" />
      </div>
      <div className="app-top-bar__right">
        {streakBadge}
      </div>
    </header>
  );
}
