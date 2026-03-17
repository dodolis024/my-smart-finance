import { useState } from 'react';
import UserAvatar from '@/components/common/UserAvatar';
import MoreMenu from '@/components/common/MoreMenu';

export default function FormColumn({ onOpenSettings, onOpenChangelog, onOpenSplit, children }) {
  const [activeDropdown, setActiveDropdown] = useState(null);

  return (
    <aside className="form-column">
      <div className="form-column__more-menu">
        <UserAvatar
          variant="desktop"
          isOpen={activeDropdown === 'avatar'}
          onOpenChange={(open) => setActiveDropdown(open ? 'avatar' : null)}
        />
        <div className="form-column__right-actions">
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
          <MoreMenu
            onOpenSettings={onOpenSettings}
            onOpenChangelog={onOpenChangelog}
            isOpen={activeDropdown === 'more'}
            onOpenChange={(open) => setActiveDropdown(open ? 'more' : null)}
          />
        </div>
      </div>
      {children}
    </aside>
  );
}
