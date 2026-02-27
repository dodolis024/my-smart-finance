/**
 * Smart Expense Tracker - 主程式初始化
 */

// 全域未捕獲的 Promise rejection 處理
window.addEventListener('unhandledrejection', (event) => {
    try {
        console.error('Unhandled promise rejection:', event.reason);
        reportError(event.reason, '發生未預期的錯誤，請稍後再試。');
    } catch (e) {
        console.error('Error in unhandledrejection handler:', e);
    }
    event.preventDefault();
});

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase 尚未載入！請檢查網路連線或 CDN 是否正常。');
        alert('無法載入 Supabase，請檢查網路連線。');
        return;
    }

    moveStreakBadgeToTopBar();
    window.addEventListener('resize', debounce(moveStreakBadgeToTopBar, DEBOUNCE.RESIZE_MS));

    const supabase = getSupabase();
    if (!supabase) {
        alert('無法初始化 Supabase，請重新整理頁面。');
        return;
    }

    try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (hashParams.get('access_token')) {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (session) {
                const { data: { user } } = await supabase.auth.getUser();
                const { data: accounts } = await supabase
                    .from('accounts')
                    .select('id')
                    .limit(1);

                if (!accounts || accounts.length === 0) {
                    await createDefaultDataForOAuth(user.id);
                }

                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
            console.error('取得 session 錯誤:', sessionError);
            window.location.href = 'auth.html';
            return;
        }

        if (!session) {
            console.log('未登入，跳轉到登入頁面');
            window.location.href = 'auth.html';
            return;
        }

        console.log('認證成功，使用者:', session.user.email);

        const userInfo = await getCurrentUserInfo();
        renderUserAvatar(userInfo);
    } catch (error) {
        console.error('初始化錯誤:', error);
        alert('初始化失敗：' + error.message);
        return;
    }

    const today = getTodayYmd();
    if (elements.dateInput) elements.dateInput.value = today;

    initMonthSelector();
    await loadCurrencyOptions();

    fetchDashboardData(currentYear, currentMonth);

    syncDashboardHeightToForm();
    window.addEventListener('resize', debounce(syncDashboardHeightToForm, DEBOUNCE.RESIZE_MS));
    window.addEventListener('load', () => { syncDashboardHeightToForm(); });

    const form = document.getElementById('transactionForm');
    if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitTransaction().catch(err => reportError(err, '記帳失敗，請稍後再試。'));
    });
    if (elements.cancelEditBtn) elements.cancelEditBtn.addEventListener('click', resetEditState);
    if (elements.monthSelect) elements.monthSelect.addEventListener('change', (e) => {
        resetEditState();
        const [y, m] = e.target.value.split('-');
        fetchDashboardData(y, m).catch(err => reportError(err, '無法讀取資料，請檢查網路或 API 網址。'));
    });

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.th-filter-btn');
        if (btn) {
            e.preventDefault();
            openFilterPopover(btn);
            return;
        }
        if (filterPopover && filterPopover.contains(e.target)) return;
        closeFilterPopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeFilterPopover();
    });

    if (elements.amountInput) {
        setupAmountInputFormatting();
    }

    if (elements.checkinBtn) {
        elements.checkinBtn.addEventListener('click', submitDailyCheckin);
    }

    if (elements.streakBadge) {
        elements.streakBadge.addEventListener('click', () => {
            openStreakModalForCurrent();
        });
    }

    if (elements.reactionCloseBtn) elements.reactionCloseBtn.addEventListener('click', closeReactionModal);
    if (elements.reactionModal) {
        elements.reactionModal.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.getAttribute && t.getAttribute('data-close') === 'true') closeReactionModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeReactionModal();
            closeMoreMenu();
            closeUserAvatarDropdown();
            closeTransactionDetail();
        }
    });

    const moreMenuBtn = document.getElementById('moreMenuBtn');
    const moreMenuDropdown = document.getElementById('moreMenuDropdown');

    if (moreMenuBtn && moreMenuDropdown) {
        moreMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMoreMenu(moreMenuBtn, moreMenuDropdown);
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.more-menu-btn') && !e.target.closest('.more-menu-dropdown')) {
            closeMoreMenu();
        }
        if (!e.target.closest('.user-avatar-btn') && !e.target.closest('.user-avatar-dropdown')) {
            closeUserAvatarDropdown();
        }
    });

    const userAvatarBtnDesktop = document.getElementById('userAvatarBtnDesktop');
    const userAvatarBtnMobile = document.getElementById('userAvatarBtnMobile');
    const userAvatarDropdownDesktop = document.getElementById('userAvatarDropdownDesktop');
    const userAvatarDropdownMobile = document.getElementById('userAvatarDropdownMobile');

    if (userAvatarBtnDesktop && userAvatarDropdownDesktop) {
        userAvatarBtnDesktop.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserAvatarDropdown(userAvatarBtnDesktop, userAvatarDropdownDesktop);
        });
    }
    if (userAvatarBtnMobile && userAvatarDropdownMobile) {
        userAvatarBtnMobile.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserAvatarDropdown(userAvatarBtnMobile, userAvatarDropdownMobile);
        });
    }

    const logoutBtnAvatarDesktop = document.getElementById('logoutBtnAvatarDesktop');
    const logoutBtnAvatarMobile = document.getElementById('logoutBtnAvatarMobile');
    [logoutBtnAvatarDesktop, logoutBtnAvatarMobile].forEach((btn) => {
        if (btn) {
            btn.addEventListener('click', asyncWithErrorHandler(async () => {
                if (confirm('確定要登出嗎？')) {
                    const supabase = getSupabase();
                    if (supabase) await supabase.auth.signOut();
                    window.location.href = 'auth.html';
                }
            }, '登出失敗，請稍後再試。'));
        }
    });

    // Settings modal
    function openSettingsModalAndCloseMenu() {
        closeMoreMenu();
        closeUserAvatarDropdown();
        openSettingsModal();
    }

    if (settingsManageBtn) {
        settingsManageBtn.addEventListener('click', openSettingsModalAndCloseMenu);
    }

    const settingsManageBtnMobile = document.getElementById('settingsManageBtnMobile');
    if (settingsManageBtnMobile) {
        settingsManageBtnMobile.addEventListener('click', openSettingsModalAndCloseMenu);
    }

    if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', closeSettingsModal);
    }

    if (settingsModal) {
        settingsModal.querySelector('.settings-manage-modal__backdrop')?.addEventListener('click', (e) => {
            if (e.target.hasAttribute('data-close')) {
                closeSettingsModal();
            }
        });

        settingsModal.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.getAttribute('data-action');
            if (action === 'add-category') {
                const type = target.getAttribute('data-type');
                if (type) addCategory(type);
            } else if (action === 'rename-category') {
                const type = target.getAttribute('data-type');
                const index = parseInt(target.getAttribute('data-index'), 10);
                if (type != null && !isNaN(index)) renameCategoryPrompt(type, index);
            } else if (action === 'delete-category') {
                const type = target.getAttribute('data-type');
                const index = parseInt(target.getAttribute('data-index'), 10);
                if (type != null && !isNaN(index)) deleteCategory(type, index);
            } else if (action === 'edit-account') {
                const accountId = target.getAttribute('data-account-id');
                if (accountId) editAccount(accountId);
            } else if (action === 'delete-account') {
                const accountId = target.getAttribute('data-account-id');
                if (accountId) deleteAccount(accountId);
            }
        });
    }

    // Changelog modal
    if (changelogBtn) {
        changelogBtn.addEventListener('click', openChangelogModalAndCloseMenu);
    }
    if (changelogBtnMobile) {
        changelogBtnMobile.addEventListener('click', openChangelogModalAndCloseMenu);
    }
    if (changelogCloseBtn) {
        changelogCloseBtn.addEventListener('click', closeChangelogModal);
    }
    if (changelogModal) {
        changelogModal.querySelector('.changelog-modal__backdrop')?.addEventListener('click', (e) => {
            if (e.target.hasAttribute('data-close')) {
                closeChangelogModal();
            }
        });
    }

    // Account form
    if (addAccountBtn) {
        addAccountBtn.addEventListener('click', showAddAccountForm);
    }

    if (cancelAccountFormBtn) {
        cancelAccountFormBtn.addEventListener('click', cancelAccountForm);
    }

    if (accountFormElement) {
        accountFormElement.addEventListener('submit', saveAccount);
    }

    if (accountTypeSelect) {
        accountTypeSelect.addEventListener('change', (e) => {
            creditCardFields.style.display = e.target.value === 'credit_card' ? 'block' : 'none';
        });
    }
});
