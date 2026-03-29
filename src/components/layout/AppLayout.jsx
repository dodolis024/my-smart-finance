import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import BottomTabBar from './BottomTabBar';
import ChangelogModal from '@/components/common/ChangelogModal';
import UnifiedSettingsModal from '@/components/settings/UnifiedSettingsModal';
import { useNavActions } from '@/contexts/NavActionsContext';
import { useChangelog } from '@/hooks/useChangelog';
import { useAuth } from '@/hooks/useAuth';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';

export default function AppLayout({ children }) {
  const mainRef = useRef(null);
  useScrollbarOnScroll(mainRef);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navActions = useNavActions();
  const { user } = useAuth();
  const { hasUnread, markAsRead } = useChangelog(user?.id);

  const openChangelog = useCallback(() => {
    setChangelogOpen(true);
    markAsRead();
  }, [markAsRead]);
  const closeChangelog = useCallback(() => setChangelogOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    navActions.register('openChangelog', openChangelog);
    navActions.register('openSettings', openSettings);
    return () => {
      navActions.unregister('openChangelog');
      navActions.unregister('openSettings');
    };
  }, [navActions, openChangelog, openSettings]);

  useEffect(() => {
    const action = navActions.consumePending();
    if (action === 'openChangelog') openChangelog();
    else if (action === 'openSettings') openSettings();
  }, [navActions, openChangelog, openSettings]);

  return (
    <div className="app-layout">
      <Sidebar hasChangelogUnread={hasUnread} changelogOpen={changelogOpen} settingsOpen={settingsOpen} />
      <main ref={mainRef} className="app-layout__main scrollbar-on-scroll">
        {children}
      </main>
      <BottomTabBar hasChangelogUnread={hasUnread} />
      <ChangelogModal isOpen={changelogOpen} onClose={closeChangelog} />
      <UnifiedSettingsModal isOpen={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
