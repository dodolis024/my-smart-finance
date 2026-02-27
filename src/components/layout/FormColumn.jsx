import UserAvatar from '@/components/common/UserAvatar';
import MoreMenu from '@/components/common/MoreMenu';

export default function FormColumn({ onOpenSettings, onOpenChangelog, confirm, children }) {
  return (
    <aside className="form-column">
      <div className="form-column__more-menu">
        <UserAvatar variant="desktop" confirm={confirm} />
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenChangelog={onOpenChangelog}
        />
      </div>
      {children}
    </aside>
  );
}
