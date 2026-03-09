import { useState, useCallback } from 'react';

export function useModalStates() {
  const [streakModal, setStreakModal] = useState({ open: false, title: '', variant: 'neutral' });
  const [creditCardModal, setCreditCardModal] = useState({ open: false, account: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  const openStreakModal = useCallback((title, variant = 'neutral') => {
    setStreakModal({ open: true, title, variant });
  }, []);

  const closeStreakModal = useCallback(() => {
    setStreakModal((s) => ({ ...s, open: false }));
  }, []);

  const openCreditCardModal = useCallback((account) => {
    setCreditCardModal({ open: true, account });
  }, []);

  const closeCreditCardModal = useCallback(() => {
    setCreditCardModal({ open: false, account: null });
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openChangelog = useCallback(() => setChangelogOpen(true), []);
  const closeChangelog = useCallback(() => setChangelogOpen(false), []);
  const openReminder = useCallback(() => setReminderOpen(true), []);
  const closeReminder = useCallback(() => setReminderOpen(false), []);

  return {
    streakModal,
    setStreakModal,
    openStreakModal,
    closeStreakModal,
    creditCardModal,
    openCreditCardModal,
    closeCreditCardModal,
    settingsOpen,
    openSettings,
    closeSettings,
    changelogOpen,
    openChangelog,
    closeChangelog,
    reminderOpen,
    openReminder,
    closeReminder,
  };
}
