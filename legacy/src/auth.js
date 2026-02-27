/**
 * Smart Expense Tracker - 認證與用戶邏輯
 */

async function getCurrentUserInfo() {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const provider = user.app_metadata?.provider || user.identities?.[0]?.provider || 'email';
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
    return {
        email: user.email || '',
        provider,
        avatarUrl,
        fullName: user.user_metadata?.full_name || user.user_metadata?.name || null
    };
}

function renderUserAvatar(userInfo) {
    if (!userInfo) return;
    const innerDesktop = document.getElementById('userAvatarInnerDesktop');
    const innerMobile = document.getElementById('userAvatarInnerMobile');
    const emailDisplayDesktop = document.getElementById('userEmailDisplayDesktop');
    const emailDisplayMobile = document.getElementById('userEmailDisplayMobile');

    const isGoogle = userInfo.provider === 'google' && userInfo.avatarUrl;
    const initial = userInfo.email ? userInfo.email[0].toUpperCase() : '?';

    function setInner(el) {
        if (!el) return;
        el.innerHTML = '';
        if (isGoogle) {
            const img = document.createElement('img');
            img.src = userInfo.avatarUrl;
            img.alt = 'User Avatar';
            img.onerror = () => { el.textContent = initial; };
            el.appendChild(img);
        } else {
            el.textContent = initial;
        }
    }

    setInner(innerDesktop);
    setInner(innerMobile);
    if (emailDisplayDesktop) emailDisplayDesktop.textContent = userInfo.email || '—';
    if (emailDisplayMobile) emailDisplayMobile.textContent = userInfo.email || '—';
}

async function createDefaultDataForOAuth(userId) {
    const supabase = getSupabase();
    if (!supabase) {
        console.error('Supabase 尚未初始化');
        return;
    }

    try {
        const { error: accountsError } = await supabase
            .from('accounts')
            .insert([
                { user_id: userId, name: '現金', type: 'cash' },
                { user_id: userId, name: '信用卡A', type: 'credit_card', credit_limit: DEFAULT_ACCOUNT.CREDIT_LIMIT, billing_day: DEFAULT_ACCOUNT.BILLING_DAY, payment_due_day: DEFAULT_ACCOUNT.PAYMENT_DUE_DAY }
            ]);

        if (accountsError) console.error('建立預設帳戶失敗:', accountsError);

        const { error: settingsError } = await supabase
            .from('settings')
            .insert([
                { user_id: userId, key: 'TWD', value: { rate: 1.0 } },
                { user_id: userId, key: 'USD', value: { rate: 30.0 } },
                { user_id: userId, key: 'JPY', value: { rate: 0.2 } },
                { user_id: userId, key: 'EUR', value: { rate: 32.0 } },
                { user_id: userId, key: 'GBP', value: { rate: 38.0 } },
                { user_id: userId, key: 'expense_categories', value: ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他'] },
                { user_id: userId, key: 'income_categories', value: ['薪水', '投資', '其他'] }
            ]);

        if (settingsError) console.error('建立預設設定失敗:', settingsError);
    } catch (error) {
        console.error('建立預設資料時發生錯誤:', error);
    }
}
