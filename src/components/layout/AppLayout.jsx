import { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import BottomTabBar from './BottomTabBar';
import ChangelogModal from '@/components/common/ChangelogModal';
import UnifiedSettingsModal from '@/components/settings/UnifiedSettingsModal';
import { useNavActions } from '@/contexts/NavActionsContext';

export default function AppLayout({ children }) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navActions = useNavActions();

  const openChangelog = useCallback(() => setChangelogOpen(true), []);
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
      <Sidebar />
      <main className="app-layout__main">
        {children}
      </main>
      <BottomTabBar />
      <ChangelogModal isOpen={changelogOpen} onClose={closeChangelog} />
      <UnifiedSettingsModal isOpen={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
