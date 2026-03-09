import UserAvatar from '@/components/common/UserAvatar';
import MoreMenu from '@/components/common/MoreMenu';

export default function FormColumn({ onOpenSettings, onOpenReminder, onOpenChangelog, children }) {
  return (
    <aside className="form-column">
      <div className="form-column__more-menu">
        <UserAvatar variant="desktop" />
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenReminder={onOpenReminder}
          onOpenChangelog={onOpenChangelog}
        />
      </div>
      {children}
    </aside>
  );
}
