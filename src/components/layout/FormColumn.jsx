import { useState } from 'react';
import UserAvatar from '@/components/common/UserAvatar';
import MoreMenu from '@/components/common/MoreMenu';

export default function FormColumn({ onOpenSettings, onOpenReminder, onOpenChangelog, children }) {
  const [activeDropdown, setActiveDropdown] = useState(null);

  return (
    <aside className="form-column">
      <div className="form-column__more-menu">
        <UserAvatar
          variant="desktop"
          isOpen={activeDropdown === 'avatar'}
          onOpenChange={(open) => setActiveDropdown(open ? 'avatar' : null)}
        />
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenReminder={onOpenReminder}
          onOpenChangelog={onOpenChangelog}
          isOpen={activeDropdown === 'more'}
          onOpenChange={(open) => setActiveDropdown(open ? 'more' : null)}
        />
      </div>
      {children}
    </aside>
  );
}
