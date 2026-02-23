/**
 * Smart Expense Tracker - Frontend Logic (Supabase Version)
 */

// ⚠️ 請將以下兩個變數替換為你的 Supabase 專案資訊
// 你可以在 Supabase Dashboard > Settings > API 中找到這些資訊
const SUPABASE_URL = 'https://rlahfuzsxfbocmkecqvg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wjxnEBkzCyZff_0ldN2_ag_jwyUaeF5';

// 初始化 Supabase Client（確保 Supabase 已載入）
// 使用 window 物件避免變數衝突，確保只初始化一次
(function() {
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase 尚未載入，請確認 script 載入順序');
        return;
    }
    
    // 初始化 supabase client（如果尚未初始化）
    if (!window.supabaseClient) {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
})();

// 取得 supabase client 的輔助函數
function getSupabase() {
    if (!window.supabaseClient && typeof window.supabase !== 'undefined') {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return window.supabaseClient;
}

// 注意：不使用頂層 supabase 變數，所有函數都使用 getSupabase() 來避免衝突

// Current State
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // JS months are 0-11

// DOM Elements (We assume your HTML uses these IDs)
// 確保你的 HTML id 跟這裡一致
const elements = {
    totalIncome: document.getElementById('totalIncome'),
    totalExpense: document.getElementById('totalExpense'),
    balance: document.getElementById('balance'),
    transactionList: document.getElementById('transactionList'), // The <tbody> or container
    categorySelect: document.getElementById('category'),
    monthSelect: document.getElementById('monthSelect'),
    addBtn: document.getElementById('addBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    formSectionTitle: document.getElementById('formSectionTitle'),
    categoryChart: document.getElementById('categoryChart'),
    categoryStats: document.getElementById('categoryStats'),
    paymentStats: document.getElementById('paymentStats'),
    // Inputs
    dateInput: document.getElementById('date'),
    itemInput: document.getElementById('item'),
    methodInput: document.getElementById('method'),
    currencyInput: document.getElementById('currency'),
    amountInput: document.getElementById('amount'),
    noteInput: document.getElementById('note'),
    // Streak UI（右上角小 icon / 連續天數）
    streakBadge: document.getElementById('streakBadge'),
    // Reaction Modal（共用的情緒回饋彈窗）
    reactionModal: document.getElementById('reactionModal'),
    reactionTitle: document.getElementById('reactionTitle'),
    reactionText: document.getElementById('reactionText'),
    streakCalendarRoot: document.getElementById('streakCalendarRoot'),
    reactionCloseBtn: document.getElementById('reactionCloseBtn'),
    // 今日簽到按鈕（當日無消費時仍可維持連續記帳天數）
    checkinBtn: document.getElementById('dailyCheckinBtn'),
    // 大螢幕時：右欄高度與左側表單對齊用
    formSection: document.querySelector('.transaction-form-section'),
    formColumn: document.querySelector('.form-column'),
    dashboardColumn: document.querySelector('.dashboard-column'),
};

// Chart.js instance for category doughnut (destroy before re-create when switching months)
let expenseChart = null;

// State: 目前畫面上的交易列表；編輯模式時為該筆 id
let currentTransactions = [];
let transactionHistoryFull = []; // 當月完整列表，供表頭篩選用
let selectedFilterCategories = [];   // 勾選的分類（空＝顯示全部）
let selectedFilterPaymentMethods = []; // 勾選的支付方式（空＝顯示全部）
let editingId = null;
let filterPopover = null;   // 點擊 icon 後顯示的 popover 節點
let filterPopoverAnchor = null; // 目前開啟的按鈕，用於關閉時比對
// Daily streak state (from backend)
// NOTE: streakState
// - count：目前連續記錄天數（由後端計算後回傳）
// - broken：true 代表昨天與今天都沒有紀錄，視為「連續紀錄中斷」
let streakState = {
    count: 0,          // 目前連續記帳天數
    broken: false,     // 是否為「昨天與今天都沒記帳」
    totalDays: 0,      // 總共記帳的「不同日期」天數
    longestStreak: 0,  // 歷史最長連續記帳天數
    loggedDates: []    // 所有有記帳的 yyyy-MM-dd 字串，用於日曆標記
};
let streakInitialHandled = false;
let streakCalendarYear = null;  // 日曆目前顯示的年份
let streakCalendarMonth = null; // 日曆目前顯示的月份（1-12）

// Professional color palette for chart segments (hue 約 13° 間隔，S=36% L=60%)
const CHART_COLORS = [
    'hsl(11, 36%, 60%)',   // 1. 烘焙奶茶
    'hsl(26, 36%, 60%)',   // 2. 煙燻陶土
    'hsl(41, 36%, 60%)',   // 3. 乾燥玫瑰灰
    'hsl(54, 36%, 58%)',   // 4. 暖木灰
    'hsl(67, 36%, 60%)',   // 5. 燕麥拿鐵
    'hsl(80, 36%, 60%)',   // 6. 灰砂色
    'hsl(93, 36%, 60%)',   // 7. 奶油杏色
    'hsl(106, 36%, 60%)',  // 8. 亞麻白粉
    'hsl(119, 36%, 60%)'   // 9. 純白珍珠
];

// =========================================
// 1. Initialization
// =========================================
// 移動 streak 按鈕到 top-bar（垂直顯示時）
let streakBadgeOriginalParent = null;

function moveStreakBadgeToTopBar() {
    const streakBadge = document.getElementById('streakBadge');
    const topBarRight = document.querySelector('.app-top-bar__right');
    
    if (!streakBadge || !topBarRight) return;
    
    // 保存原始父元素（只在第一次時）
    if (!streakBadgeOriginalParent && streakBadge.parentElement !== topBarRight) {
        streakBadgeOriginalParent = streakBadge.parentElement;
    }
    
    // 檢查是否為垂直顯示（寬度 ≤ 1200px）
    const isVertical = window.matchMedia('(max-width: 1200px)').matches;
    
    if (isVertical) {
        // 垂直顯示：移動到 top-bar 右側容器（與左側更多選單對稱）
        if (streakBadge.parentElement !== topBarRight) {
            topBarRight.appendChild(streakBadge);
        }
    } else {
        // 水平顯示：移動回原位置
        if (streakBadgeOriginalParent && streakBadge.parentElement !== streakBadgeOriginalParent) {
            // 找到原本的位置（在更多選單按鈕之前）
            const moreMenuBtn = streakBadgeOriginalParent.querySelector('.more-menu-btn--desktop');
            if (moreMenuBtn) {
                streakBadgeOriginalParent.insertBefore(streakBadge, moreMenuBtn);
            } else {
                streakBadgeOriginalParent.appendChild(streakBadge);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // 確保 Supabase 已載入
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase 尚未載入！請檢查網路連線或 CDN 是否正常。');
        alert('無法載入 Supabase，請檢查網路連線。');
        return;
    }
    
    // 移動 streak 按鈕到 top-bar（如果適用）
    moveStreakBadgeToTopBar();
    
    // 監聽視窗大小變化
    window.addEventListener('resize', moveStreakBadgeToTopBar);

    // 取得 supabase client
    const supabase = getSupabase();
    if (!supabase) {
        alert('無法初始化 Supabase，請重新整理頁面。');
        return;
    }

    try {
        // 處理 OAuth 回調（當用戶從 Google 返回時）
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (hashParams.get('access_token')) {
            // OAuth 回調，等待 session 建立
            const { data: { session }, error } = await supabase.auth.getSession();
            if (session) {
                // 檢查是否為新用戶，建立預設資料
                const { data: { user } } = await supabase.auth.getUser();
                const { data: accounts } = await supabase
                    .from('accounts')
                    .select('id')
                    .limit(1);
                
                if (!accounts || accounts.length === 0) {
                    // 新用戶，建立預設資料
                    await createDefaultDataForOAuth(user.id);
                }
                
                // 清除 URL hash，避免重複處理
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }

        // 檢查認證狀態
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
            console.error('取得 session 錯誤:', sessionError);
            // 不顯示 alert，直接跳轉到登入頁面
            window.location.href = 'auth.html';
            return;
        }
        
        if (!session) {
            // 未登入，跳轉到登入頁面
            console.log('未登入，跳轉到登入頁面');
            window.location.href = 'auth.html';
            return;
        }

        console.log('認證成功，使用者:', session.user.email);
    } catch (error) {
        console.error('初始化錯誤:', error);
        alert('初始化失敗：' + error.message);
        return;
    }

    // Set Date input to today (使用台灣時區)
    const today = getTodayYmd();
    if(elements.dateInput) elements.dateInput.value = today;

    // Load Month Selector (Optional: Simple last 6 months)
    initMonthSelector();

    // 動態載入幣別選單（來自中央匯率表 exchange_rates）
    await loadCurrencyOptions();

    // Fetch Initial Data
    fetchDashboardData(currentYear, currentMonth);

    // 大螢幕：右側儀表板最高與左側表單下緣對齊（滑到底時不超過表單）
    syncDashboardHeightToForm();
    window.addEventListener('resize', syncDashboardHeightToForm);
    window.addEventListener('load', () => { syncDashboardHeightToForm(); });

    // Attach Event Listeners（表單用 submit + preventDefault，避免 type="submit" 造成頁面重載）
    const form = document.getElementById('transactionForm');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitTransaction(); });
    if (elements.cancelEditBtn) elements.cancelEditBtn.addEventListener('click', resetEditState);
    if (elements.monthSelect) elements.monthSelect.addEventListener('change', (e) => {
        resetEditState();
        const [y, m] = e.target.value.split('-');
        fetchDashboardData(y, m);
    });

    // 表頭篩選 icon 點擊：顯示 popover，由 openFilterPopover 處理
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

    // 金額輸入欄位：自動格式化千分位逗號
    if (elements.amountInput) {
        setupAmountInputFormatting();
    }

    // 今日簽到：當天即使沒有消費，也可點擊避免連續記帳天數中斷
    if (elements.checkinBtn) {
        elements.checkinBtn.addEventListener('click', submitDailyCheckin);
    }

    // 點擊右上角小 icon，隨時打開 streak 視窗
    if (elements.streakBadge) {
        elements.streakBadge.addEventListener('click', () => {
            openStreakModalForCurrent();
        });
    }

    // Reaction Modal interactions
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
            closeTransactionDetail();
        }
    });

    // 更多選單按鈕（桌面版和手機版）
    const moreMenuBtn = document.getElementById('moreMenuBtn');
    const moreMenuBtnMobile = document.getElementById('moreMenuBtnMobile');
    const moreMenuDropdown = document.getElementById('moreMenuDropdown');
    const moreMenuDropdownMobile = document.getElementById('moreMenuDropdownMobile');

    console.log('更多選單元素:', { moreMenuBtn, moreMenuBtnMobile, moreMenuDropdown, moreMenuDropdownMobile });

    if (moreMenuBtn && moreMenuDropdown) {
        console.log('綁定桌面版更多選單事件');
        moreMenuBtn.addEventListener('click', (e) => {
            console.log('桌面版更多選單被點擊');
            e.stopPropagation();
            toggleMoreMenu(moreMenuBtn, moreMenuDropdown);
        });
    }

    if (moreMenuBtnMobile && moreMenuDropdownMobile) {
        console.log('綁定手機版更多選單事件');
        moreMenuBtnMobile.addEventListener('click', (e) => {
            console.log('手機版更多選單被點擊');
            e.stopPropagation();
            toggleMoreMenu(moreMenuBtnMobile, moreMenuDropdownMobile);
        });
    }

    // 點擊外部關閉選單
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.more-menu-btn') && !e.target.closest('.more-menu-dropdown')) {
            closeMoreMenu();
        }
    });

    // 登出按鈕（在更多選單中）
    const logoutBtn = document.getElementById('logoutBtn');
    const logoutBtnMobile = document.getElementById('logoutBtnMobile');
    
    [logoutBtn, logoutBtnMobile].forEach((btn) => {
        if (btn) {
            btn.addEventListener('click', async () => {
                if (confirm('確定要登出嗎？')) {
                    const supabase = getSupabase();
                    if (supabase) {
                        await supabase.auth.signOut();
                    }
                    window.location.href = 'auth.html';
                }
            });
        }
    });
});

// =========================================
// 2. Fetch Data (GET) - Supabase Version
// =========================================
async function fetchDashboardData(year, month) {
    try {
        setLoading(true);
        console.log(`Fetching data for ${year}-${month}...`);
        
        // 取得 supabase client
        const supabase = getSupabase();
        if (!supabase) {
            throw new Error('Supabase 尚未初始化');
        }
        
        // 呼叫 Supabase 函數取得儀表板資料
        // 參數順序須與 DB 函數一致（PostgREST 依字母順序比對）
        // p_client_today: 用戶裝置的今天日期（用於 streak 計算）
        const { data, error } = await supabase.rpc('get_dashboard_data', {
            p_client_today: getTodayYmd(),
            p_month: parseInt(month, 10),
            p_year: parseInt(year, 10)
        });

        if (error) throw new Error(error.message || '無法取得資料');
        if (!data || !data.success) throw new Error(data?.error || '無法取得資料');

        // A. Update Stats Cards
        updateStats(data.summary);

        // A2. Daily Streak（從後端帶回 streakCount / streakBroken，更新右上角 icon 與後續彈窗判斷）
        updateStreakStateFromServer(data);
        // NOTE: 首次載入頁面時：若 streak 斷掉，在當日第一個進站時彈出「生氣」視窗（一天只提醒一次）
        if (!streakInitialHandled) {
            streakInitialHandled = true;
            maybeShowBrokenModalOnLoad();
        }

        // B. Update Transaction Table（表頭篩選：點 icon 才顯示選項）
        transactionHistoryFull = data.history || [];
        applyTableFilter();

        // C. Update Category Chart & Stats（只針對支出分類繪製圓餅圖）
        renderChart(data.history, data.categoriesIncome);

        // D. Update Payment Stats
        renderPaymentStats(data.history);

        // E. Update Categories（每次都更新，確保類別管理變更後能立即反映）
        populateCategories(data);

        // F. Update Payment Methods from Accounts（每次更新，與 Accounts 分頁同步）
        populatePaymentMethods(data.accounts);

        // NOTE: 若未來需要在外層直接取得 dashboard 資料，可使用 return data;
        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        alert('無法讀取資料，請檢查網路或 API 網址。');
        return null;
    } finally {
        setLoading(false);
        syncDashboardHeightToForm();
    }
}

// =========================================
// Daily Streak UI + Reaction Modal（情境邏輯）
// =========================================
function updateStreakStateFromServer(data) {
    const count = data && typeof data.streakCount === 'number' ? data.streakCount : 0;
    const broken = !!(data && data.streakBroken);
    const totalDays = data && typeof data.totalLoggedDays === 'number' ? data.totalLoggedDays : 0;
    const longestStreak = data && typeof data.longestStreak === 'number' ? data.longestStreak : 0;
    const rawLogged = Array.isArray(data && data.loggedDates) ? data.loggedDates.slice() : [];
    // 支援新格式 [{date, source}, ...] 與舊格式 [dateStr, ...]
    const loggedDates = rawLogged.map((d) => (typeof d === 'string' ? d : d.date));
    streakState.loggedDatesWithSource = rawLogged;

    streakState.count = count;
    streakState.broken = broken;
    streakState.totalDays = totalDays;
    streakState.longestStreak = longestStreak;
    streakState.loggedDates = loggedDates;
    updateStreakBadge();

    // 今日若已簽到（包含準時記帳或按簽到），就停用簽到按鈕，避免重複操作
    const today = getTodayYmd();
    const hasCheckinToday = loggedDates.indexOf(today) !== -1;
    if (elements.checkinBtn) {
        elements.checkinBtn.disabled = hasCheckinToday;
        elements.checkinBtn.classList.toggle('btn-checkin-disabled', hasCheckinToday);
    }
}

function updateStreakBadge() {
    if (!elements.streakBadge) return;
    const count = streakState.count || 0;
    let iconHtml = '';
    if (streakState.broken) {
        iconHtml = '😡';
    } else if (count > 0) {
        // 使用 fire SVG icon（描邊漸層、中心透明）
        iconHtml = '<svg class="icon-fire" aria-hidden="true"><use href="#icon-fire"></use></svg>';
    } else {
        iconHtml = '✨';
    }
    // NOTE：如果想改右上角的小圖示（例如全部改成 icon），可以在這裡調整 iconHtml 的內容
    const iconSpan = elements.streakBadge.querySelector('.streak-badge__icon');
    if (iconSpan) iconSpan.innerHTML = iconHtml;
    elements.streakBadge.querySelector('.streak-badge__count').textContent = String(count);
}

// 首次載入，若 streak 斷掉，且今天尚未顯示過「生氣」視窗，就彈一次
function maybeShowBrokenModalOnLoad() {
    if (!streakState.broken) return;
    const today = getTodayYmd();
    try {
        const shownFor = window.localStorage.getItem('streakBrokenShownDate');
        if (shownFor === today) return;
        openStreakModalForBroken();
        window.localStorage.setItem('streakBrokenShownDate', today);
    } catch (e) {
        openStreakModalForBroken();
    }
}

// 新增當日第一筆資料後（非編輯），在 streak 仍然連續時顯示「開心」視窗（每天只顯示一次）
function maybeShowPositiveModalAfterAdd(submittedDate) {
    const today = getTodayYmd();
    if (!submittedDate || submittedDate !== today) return;
    if (streakState.broken) return;
    if (!streakState.count || streakState.count <= 0) return;

    try {
        const shownFor = window.localStorage.getItem('streakPositiveShownDate');
        if (shownFor === today) return;
        openStreakModalForPositive();
        window.localStorage.setItem('streakPositiveShownDate', today);
    } catch (e) {
        openStreakModalForPositive();
    }
}

// 依照目前 streak 狀態（包含 milestone）開啟「開心」視窗
function openStreakModalForPositive() {
    const count = streakState.count || 0;
    const milestoneSteps = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
    let title = '怎麼這麼乖呀！';
    let text = '今天是記帳的第 ${count} 天，明天也要繼續保持呦☺️';
    // milestone 特別文案
    if (milestoneSteps.includes(count)) {
        title = '里程碑達成！';
        text = '你已經連續記帳 ${count} 天了！真棒真棒🥹';
    }
    // TODO：想要不同天數有不同文字或 emoji，可在這裡依照 count 改寫 title / text
    renderStreakCalendar();
    openReactionModal({
        title,
        text,
        buttonLabel: '太讚了，繼續！',
        variant: 'positive'
    });
}

// streak 斷掉（昨天沒記），在載入時顯示「生氣 / 難過」視窗
function openStreakModalForBroken() {
    // TODO：這裡可以改成你喜歡的「生氣 / 難過」文字與 emoji
    renderStreakCalendar();
    openReactionModal({
        title: '小壞蛋 你偷懶被抓到了！！！',
        text: '吼呦！你昨天迷有記帳 氣鼠了！😡',
        buttonLabel: '我現在補記！',
        variant: 'broken'
    });
}

// 使用者點右上角小 icon 時：打開一個「總覽」視窗，顯示目前 streak 狀態
function openStreakModalForCurrent() {
    const count = streakState.count || 0;
    // 日曆由 openReactionModal 內重置為當月並渲染，不在此重複
    if (streakState.broken) {
        openReactionModal({
            title: '目前連續記帳：0 天',
            text: '目前沒有連續紀錄，今天要重新開始咪～～',
            buttonLabel: '好鴨',
            variant: 'neutral'
        });
    } else if (count > 0) {
        openReactionModal({
            title: `目前連續記帳：${count} 天`,
            text: `太厲害了！已經連續記錄 ${count} 天，繼續往下一個里程碑前進吧！🔥`, /* 用不到他 */
            buttonLabel: '好的',
            variant: 'neutral'
        });
    } else {
        openReactionModal({
            title: '還沒有連續紀錄',
            text: '從今天開始記第一筆，就會開始累積你的連續紀錄！',
            buttonLabel: 'Go Go!',
            variant: 'neutral'
        });
    }
}

function getTodayYmd() {
    // 使用裝置當地時區的日期（支援旅行時自動跟隨所在地時區）
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// =========================================
// Daily Check-in（當天無消費時仍可維持 streak）- Supabase Version
// =========================================
async function submitDailyCheckin() {
    const btn = elements.checkinBtn;
    if (!btn) return;
    const originalText = btn.innerText;
    try {
        btn.disabled = true;
        btn.innerText = '簽到中...';

        const today = getTodayYmd();
        
        // 取得 supabase client
        const supabase = getSupabase();
        if (!supabase) {
            throw new Error('Supabase 尚未初始化');
        }

        // 取得目前使用者（RLS 要求 INSERT/UPDATE 時帶入 user_id）
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            throw new Error('請先登入');
        }
        
        // 使用 upsert 確保同一天只有一筆記錄
        const { error } = await supabase
            .from('checkins')
            .upsert({
                user_id: user.id,
                date: today,
                source: 'manual'
            }, {
                onConflict: 'user_id,date'
            });

        if (error) throw error;

        // 重新讀取目前儀表板（包含 streak 與日曆）；updateStreakStateFromServer 會依 loggedDates 停用簽到按鈕
        const v = elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [currentYear, currentMonth];
        await fetchDashboardData(parseInt(v[0], 10), parseInt(v[1], 10));
        alert('今日簽到成功！');
        btn.innerText = originalText;
        // 成功後按鈕是否停用由 updateStreakStateFromServer 依今日是否已在 loggedDates 決定，不再於 finally 強制啟用
    } catch (err) {
        console.error('Error check-in:', err);
        alert(err.message || '簽到失敗，請稍後再試。');
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// NOTE: renderStreakCalendar
// - 依據 streakState.loggedDates 在 modal 內渲染「可切換月份」的日曆與下方三個統計卡片
// - 只負責畫面，不處理彈窗開關邏輯（開關由 openReactionModal 處理）
function renderStreakCalendar() {
    if (!elements.streakCalendarRoot) return;

    ensureStreakCalendarMonth();

    const y = streakCalendarYear;
    const m = streakCalendarMonth;

    // 依 source 區分：記帳簽到 (onTimeTransaction) / 簽到按鈕 (manual)，供日曆顯示兩種顏色
    const loggedBySource = { onTimeTransaction: new Set(), manual: new Set() };
    (streakState.loggedDatesWithSource || streakState.loggedDates || []).forEach((item) => {
        const dateStr = typeof item === 'string' ? item : (item && item.date);
        if (!dateStr) return;
        const source = typeof item === 'object' && item && 'source' in item ? item.source : null;
        const src = source != null ? String(source) : '';
        if (src === 'onTimeTransaction') loggedBySource.onTimeTransaction.add(dateStr);
        else loggedBySource.manual.add(dateStr); // 'manual' 或舊格式、未知來源都視為簽到按鈕
    });

    const firstDay = new Date(y, m - 1, 1);
    const firstWeekday = firstDay.getDay(); // 0-6 (Sun-Sat)
    const daysInMonth = new Date(y, m, 0).getDate();
    const todayStr = getTodayYmd();

    const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];

    let html = '';
    html += '<div class="streak-calendar">';
    html += '  <div class="streak-calendar__header">';
    html += '    <button type="button" class="streak-calendar__nav-btn" data-dir="-1" aria-label="上一個月">‹</button>';
    html += `    <div class="streak-calendar__month">${y} 年 ${m} 月</div>`;
    html += '    <button type="button" class="streak-calendar__nav-btn" data-dir="1" aria-label="下一個月">›</button>';
    html += '  </div>';
    html += '  <div class="streak-calendar__weekdays">';
    weekLabels.forEach((w) => {
        html += `<div class="streak-calendar__weekday">${w}</div>`;
    });
    html += '  </div>';
    html += '  <div class="streak-calendar__grid">';

    // 前置空白格
    for (let i = 0; i < firstWeekday; i++) {
        html += '<div class="streak-calendar__day streak-calendar__day--empty"><div class="streak-calendar__day-inner"></div></div>';
    }

    // 每一天
    for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        const dateStr = `${y}-${mm}-${dd}`;
        const isTransaction = loggedBySource.onTimeTransaction.has(dateStr);
        const isManual = loggedBySource.manual.has(dateStr);
        const isToday = dateStr === todayStr;
        const isFuture = dateStr > todayStr;

        let cls = 'streak-calendar__day';
        // 未來日期不顯示簽到標記（即使有記錄），避免跨時區時顯示「還沒發生」的日期
        if (!isFuture) {
            if (isTransaction) cls += ' streak-calendar__day--transaction';
            else if (isManual) cls += ' streak-calendar__day--manual';
        }
        if (isToday) cls += ' streak-calendar__day--today';

        html += `<div class="${cls}"><div class="streak-calendar__day-inner">${d}</div></div>`;
    }

    html += '  </div>'; // grid
    html += '  <div class="streak-calendar__legend">';
    html += '    <span class="streak-calendar__legend-item streak-calendar__legend-item--transaction">記帳</span>';
    html += '    <span class="streak-calendar__legend-item streak-calendar__legend-item--manual">簽到</span>';
    html += '  </div>';
    html += '</div>'; // calendar

    // Summary cards
    const current = streakState.count || 0;
    const total = streakState.totalDays || 0;
    const longest = streakState.longestStreak || 0;
    // NOTE: streakIconHtml
    // - 目前連續記帳天數卡片使用 fire icon（SVG）
    // - 若 future 想改成別的 icon，可在這裡替換 <use href="#icon-fire">
    const streakIconHtml =
        current > 0
            ? '<svg class="icon-fire" aria-hidden="true"><use href="#icon-fire"></use></svg>'
            : '';
    html += '<div class="streak-summary">';
    html += '  <div class="streak-summary__card">';
    html += '    <div class="streak-summary__label">目前連續記帳天數</div>';
    html += '    <div class="streak-summary__value">';
    html += `      <span class="streak-summary__value-emoji">${streakIconHtml}</span>`;
    html += `      <span class="streak-summary__value-number">${current}</span><span>天</span>`;
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="streak-summary__card">';
    html += '    <div class="streak-summary__label">總共記帳天數</div>';
    html += '    <div class="streak-summary__value">';
    html += `      <span class="streak-summary__value-number">${total}</span><span>天</span>`;
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="streak-summary__card">';
    html += '    <div class="streak-summary__label">最長連續記帳</div>';
    html += '    <div class="streak-summary__value">';
    html += `      <span class="streak-summary__value-number">${longest}</span><span>天</span>`;
    html += '    </div>';
    html += '  </div>';

    html += '</div>'; // streak-summary

    elements.streakCalendarRoot.innerHTML = html;

    // 綁定上一月 / 下一月按鈕
    const root = elements.streakCalendarRoot;
    const navButtons = root.querySelectorAll('.streak-calendar__nav-btn');
    navButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const dir = parseInt(btn.getAttribute('data-dir'), 10) || 0;
            const nextMonth = new Date(streakCalendarYear, streakCalendarMonth - 1 + dir, 1);
            streakCalendarYear = nextMonth.getFullYear();
            streakCalendarMonth = nextMonth.getMonth() + 1;
            renderStreakCalendar();
        });
    });
}

// 日曆一律預設當月，不記憶上次停在哪一頁（實際重置在 openReactionModal 內完成）
function ensureStreakCalendarMonth() {
    if (streakCalendarYear != null && streakCalendarMonth != null) return;
    const now = new Date();
    streakCalendarYear = now.getFullYear();
    streakCalendarMonth = now.getMonth() + 1;
}

function openReactionModal(opts) {
    if (!elements.reactionModal) return;
    // 每次打開彈窗都預設顯示當月，不記憶上次停在哪一頁
    const now = new Date();
    streakCalendarYear = now.getFullYear();
    streakCalendarMonth = now.getMonth() + 1;
    renderStreakCalendar();
    if (elements.reactionTitle) elements.reactionTitle.textContent = (opts && opts.title) ? opts.title : '提醒';
    // 目前已不顯示文字段落，如需再次顯示，可在 style.css 取消 reaction-modal__text 的 display:none
    if (elements.reactionText) elements.reactionText.textContent = '';
    // TODO：若未來想根據 variant 顯示不同圖片，可在這裡根據 opts.variant 改變 reactionMedia 的背景圖
    if (elements.reactionModal) {
        elements.reactionModal.classList.add('is-open');
        elements.reactionModal.setAttribute('aria-hidden', 'false');
        elements.reactionModal.setAttribute('data-variant', (opts && opts.variant) ? opts.variant : 'default');
    }
    document.body.classList.add('modal-open');
}

function closeReactionModal() {
    if (!elements.reactionModal) return;
    elements.reactionModal.classList.remove('is-open');
    elements.reactionModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

// =========================================
// Transaction Detail Modal
// =========================================
function showTransactionDetail(tx) {
    if (!tx) return;
    
    // 創建彈窗容器（如果不存在）
    let modal = document.getElementById('transactionDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'transactionDetailModal';
        modal.className = 'transaction-detail-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'transactionDetailTitle');
        modal.setAttribute('aria-hidden', 'true');
        document.body.appendChild(modal);
        
        // 點擊背景關閉
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-close="modal"]')) {
                closeTransactionDetail();
            }
        });
    }
    
    // 格式化金額顯示
    const originalAmount = tx.originalAmount != null ? tx.originalAmount : (tx.amount != null ? tx.amount : tx.twdAmount);
    const currency = tx.currency || 'TWD';
    const exchangeRate = tx.exchangeRate || 1.0;
    const twdAmount = tx.twdAmount || 0;
    const note = tx.note || '無';
    
    // 構建詳情內容
    let html = '<div class="transaction-detail-content">';
    html += '  <div class="transaction-detail-header">';
    html += '    <h2 id="transactionDetailTitle" class="transaction-detail-title">交易詳情</h2>';
    html += '    <button type="button" class="transaction-detail-close" data-close="modal" aria-label="關閉">';
    html += '      <svg class="icon-close" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    html += '        <line x1="18" y1="6" x2="6" y2="18"></line>';
    html += '        <line x1="6" y1="6" x2="18" y2="18"></line>';
    html += '      </svg>';
    html += '    </button>';
    html += '  </div>';
    html += '  <div class="transaction-detail-body">';
    
    // 日期
    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">日期</div>';
    html += `      <div class="transaction-detail-value">${escapeHtml(tx.date)}</div>`;
    html += '    </div>';
    
    // 分類
    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">分類</div>';
    html += `      <div class="transaction-detail-value"><span class="badge">${escapeHtml(tx.category)}</span></div>`;
    html += '    </div>';
    
    // 項目
    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">項目</div>';
    html += `      <div class="transaction-detail-value">${escapeHtml(tx.itemName)}</div>`;
    html += '    </div>';
    
    // 原始金額
    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">金額</div>';
    html += `      <div class="transaction-detail-value transaction-detail-amount">${formatNumberWithCommas(String(originalAmount))} ${escapeHtml(currency)}</div>`;
    html += '    </div>';
    
    // 如果不是台幣，顯示匯率和台幣金額
    if (currency !== 'TWD') {
        html += '    <div class="transaction-detail-item">';
        html += '      <div class="transaction-detail-label">匯率</div>';
        html += `      <div class="transaction-detail-value">${exchangeRate.toFixed(4)}</div>`;
        html += '    </div>';
        
        html += '    <div class="transaction-detail-item">';
        html += '      <div class="transaction-detail-label">台幣金額</div>';
        html += `      <div class="transaction-detail-value transaction-detail-amount">${formatMoney(twdAmount)}</div>`;
        html += '    </div>';
    }
    
    // 支付方式
    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">支付方式</div>';
    html += `      <div class="transaction-detail-value">${escapeHtml(tx.paymentMethod)}</div>`;
    html += '    </div>';
    
    // 備註
    html += '    <div class="transaction-detail-item transaction-detail-item--note">';
    html += '      <div class="transaction-detail-label">備註</div>';
    html += `      <div class="transaction-detail-value transaction-detail-note">${escapeHtml(note)}</div>`;
    html += '    </div>';
    
    html += '  </div>';
    html += '</div>';
    
    modal.innerHTML = html;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function closeTransactionDetail() {
    const modal = document.getElementById('transactionDetailModal');
    if (!modal) return;
    
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

// =========================================
// More Menu Toggle
// =========================================
function toggleMoreMenu(btn, dropdown) {
    console.log('toggleMoreMenu 被調用', { btn, dropdown });
    const isOpen = dropdown.classList.contains('is-open');
    console.log('選單狀態:', isOpen ? '開啟' : '關閉');
    closeMoreMenu(); // 先關閉所有選單
    if (!isOpen) {
        console.log('打開選單');
        dropdown.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
    }
}

function closeMoreMenu() {
    const dropdowns = document.querySelectorAll('.more-menu-dropdown');
    const btns = document.querySelectorAll('.more-menu-btn');
    dropdowns.forEach(d => d.classList.remove('is-open'));
    btns.forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function focusTransactionInput() {
    const form = document.getElementById('transactionForm');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
    if (elements.itemInput) {
        setTimeout(() => elements.itemInput.focus(), 150);
    }
}

// =========================================
// 金額輸入欄位格式化（千分位逗號）
// =========================================
function formatNumberWithCommas(value) {
    // 移除所有非數字字符（保留小數點）
    const cleaned = value.replace(/[^\d.]/g, '');
    // 只保留第一個小數點
    const parts = cleaned.split('.');
    let integerPart = parts[0] || '';
    const decimalPart = parts.length > 1 ? '.' + parts[1].slice(0, 2) : '';
    
    // 格式化整數部分（加上千分位逗號）
    if (integerPart) {
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    
    return integerPart + decimalPart;
}

function parseFormattedNumber(value) {
    // 移除所有逗號，保留數字和小數點
    return value.replace(/,/g, '');
}

function setupAmountInputFormatting() {
    if (!elements.amountInput) return;
    
    // 輸入時格式化
    elements.amountInput.addEventListener('input', (e) => {
        const cursorPosition = e.target.selectionStart;
        const oldValue = e.target.value;
        const formatted = formatNumberWithCommas(oldValue);
        
        // 計算游標新位置（考慮新增或移除的逗號）
        // 計算游標前有多少個逗號
        const commasBeforeCursor = (oldValue.substring(0, cursorPosition).match(/,/g) || []).length;
        const newCommasBeforeCursor = (formatted.substring(0, cursorPosition).match(/,/g) || []).length;
        const cursorAdjustment = newCommasBeforeCursor - commasBeforeCursor;
        const newCursorPosition = cursorPosition + cursorAdjustment;
        
        e.target.value = formatted;
        
        // 恢復游標位置
        setTimeout(() => {
            e.target.setSelectionRange(newCursorPosition, newCursorPosition);
        }, 0);
    });
    
    // 失去焦點時確保格式正確
    elements.amountInput.addEventListener('blur', (e) => {
        const value = e.target.value.trim();
        if (value) {
            e.target.value = formatNumberWithCommas(value);
        }
    });
    
    // 防止貼上非數字內容
    elements.amountInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        const cleaned = parseFormattedNumber(pastedText);
        if (cleaned) {
            const formatted = formatNumberWithCommas(cleaned);
            e.target.value = formatted;
            // 將游標移到最後
            setTimeout(() => {
                e.target.setSelectionRange(formatted.length, formatted.length);
            }, 0);
        }
    });
}

// =========================================
// 3. Submit Data (POST) - Supabase Version
// =========================================
async function submitTransaction() {
    // Basic Validation
    if (!elements.itemInput.value || !elements.amountInput.value) {
        alert('請填寫項目名稱與金額！');
        return;
    }
    if (!elements.methodInput.value) {
        alert('請選擇支付方式！');
        return;
    }

    // 取得 supabase client
    const supabase = getSupabase();
    if (!supabase) {
        alert('Supabase 尚未初始化，請重新整理頁面。');
        return;
    }

    try {
        const btn = elements.addBtn;
        const originalText = btn.innerText;
        btn.innerText = "儲存中...";
        btn.disabled = true;

        const date = elements.dateInput.value;
        const itemName = elements.itemInput.value;
        const category = elements.categorySelect.value;
        const paymentMethod = elements.methodInput.value;
        const currency = elements.currencyInput.value || 'TWD';
        // 移除千分位逗號後再解析數字
        const amountValue = parseFormattedNumber(elements.amountInput.value);
        const amount = parseFloat(amountValue);
        if (isNaN(amount) || amount <= 0) {
            alert('請輸入有效的金額！');
            btn.disabled = false;
            btn.innerText = originalText;
            return;
        }
        const note = elements.noteInput.value || null;

        // 判斷是收入還是支出（根據類別）
        const { data: incomeCategories } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'income_categories')
            .single();

        const incomeCats = incomeCategories?.value || ['薪水', '投資'];
        const isIncome = Array.isArray(incomeCats) && incomeCats.includes(category);
        const type = isIncome ? 'income' : 'expense';

        // 取得匯率（從中央 exchange_rates 表）
        const { data: exchangeRateVal, error: rateErr } = await supabase
            .rpc('get_exchange_rate', { p_currency: currency.trim().toUpperCase() });

        const exchangeRate = (rateErr == null && exchangeRateVal != null && exchangeRateVal > 0)
            ? Number(exchangeRateVal) : 1.0;
        const twdAmount = Math.round(amount * exchangeRate * 100) / 100;

        // 取得目前使用者（RLS 要求 INSERT 時帶入 user_id）
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            alert('請先登入');
            return;
        }

        // 尋找對應的 account_id（根據 payment_method 名稱）
        const { data: account } = await supabase
            .from('accounts')
            .select('id')
            .eq('name', paymentMethod)
            .single();

        const transactionData = {
            user_id: user.id,
            date,
            type,
            item_name: itemName,
            category,
            payment_method: paymentMethod,
            account_id: account?.id || null,
            currency: currency.toUpperCase(),
            amount,
            exchange_rate: exchangeRate,
            twd_amount: twdAmount,
            note
        };

        if (editingId) {
            // 更新交易
            const { error } = await supabase
                .from('transactions')
                .update(transactionData)
                .eq('id', editingId);

            if (error) throw error;

            const wasEdit = true;
            const submittedDate = date;
            const [y, m] = submittedDate ? submittedDate.split('-') : (elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [String(currentYear), String(currentMonth)]);
            resetEditState(true); // 完成編輯後滾動到交易紀錄列表
            await fetchDashboardData(parseInt(y, 10), parseInt(m, 10));
            alert('已更新。');
        } else {
            // 新增交易
            const { error } = await supabase
                .from('transactions')
                .insert(transactionData);

            if (error) throw error;

            // 若使用者在「今天」新增一筆，且日期欄位也是今天，則視為當日有準時記帳，寫入 Checkins
            const today = getTodayYmd();
            if (date === today) {
                await supabase
                    .from('checkins')
                    .upsert({
                        user_id: user.id,
                        date: today,
                        source: 'onTimeTransaction'
                    }, {
                        onConflict: 'user_id,date'
                    });
            }

            const wasEdit = false;
            const submittedDate = date;
            const [y, m] = submittedDate ? submittedDate.split('-') : (elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [String(currentYear), String(currentMonth)]);
            resetEditState();
            await fetchDashboardData(parseInt(y, 10), parseInt(m, 10));
            // 新增當日第一筆資料後彈出「開心」視窗；編輯不觸發
            maybeShowPositiveModalAfterAdd(submittedDate);
            alert('記帳成功！');
        }

    } catch (error) {
        console.error('Error submitting:', error);
        alert(error.message || '記帳失敗，請稍後再試。');
    } finally {
        const btn = elements.addBtn;
        btn.innerText = editingId ? "更新交易" : "新增交易";
        btn.disabled = false;
    }
}

/**
 * 刪除一筆交易 - Supabase Version
 */
async function deleteTransaction(id) {
    if (!id) return;
    if (!confirm('確定要刪除這筆交易嗎？')) return;

    // 取得 supabase client
    const supabase = getSupabase();
    if (!supabase) {
        alert('Supabase 尚未初始化，請重新整理頁面。');
        return;
    }

    try {
        setLoading(true);
        
        const { error } = await supabase
            .from('transactions')
            .delete()
            .eq('id', id);

        if (error) throw error;

        const v = elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [currentYear, currentMonth];
        await fetchDashboardData(parseInt(v[0], 10), parseInt(v[1], 10));
        alert('已刪除。');
    } catch (error) {
        console.error('Error deleting:', error);
        alert(error.message || '刪除失敗，請稍後再試。');
    } finally {
        setLoading(false);
    }
}

/**
 * 清除編輯狀態並還原表單：用於取消、送出成功、切換月份時。
 * @param {boolean} scrollToHistory - 是否滾動到交易紀錄列表（預設：如果正在編輯模式則滾動）
 */
function resetEditState(scrollToHistory) {
    const wasEditing = editingId !== null;
    editingId = null;
    const today = getTodayYmd();
    if (elements.dateInput) elements.dateInput.value = today;
    if (elements.itemInput) elements.itemInput.value = '';
    if (elements.amountInput) elements.amountInput.value = '';
    if (elements.noteInput) elements.noteInput.value = '';
    if (elements.categorySelect) elements.categorySelect.value = '';
    if (elements.methodInput) elements.methodInput.value = '';
    if (elements.addBtn) elements.addBtn.innerText = '新增交易';
    if (elements.cancelEditBtn) elements.cancelEditBtn.style.display = 'none';
    if (elements.formSectionTitle) elements.formSectionTitle.textContent = '新增交易';
    
    // 如果正在編輯模式（取消或完成編輯），滾動到交易紀錄列表
    if (wasEditing && (scrollToHistory !== false)) {
        scrollToTransactionHistory();
    }
}

/**
 * 滾動到交易紀錄列表
 */
function scrollToTransactionHistory() {
    const historySection = document.querySelector('.transaction-history-section');
    if (historySection) {
        // 使用 setTimeout 確保 DOM 更新完成後再滾動
        setTimeout(() => {
            historySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

// =========================================
// 4. Helper Functions
// =========================================

function updateStats(summary) {
    // 收支概覽卡片：四捨五入到整數
    if(elements.totalIncome) elements.totalIncome.innerText = formatMoney(Math.round(summary.totalIncome));
    if(elements.totalExpense) elements.totalExpense.innerText = formatMoney(Math.round(summary.totalExpense));
    if(elements.balance) elements.balance.innerText = formatMoney(Math.round(summary.balance));
    
    // Optional: Color the balance
    if (elements.balance) {
        elements.balance.classList.remove('balance-positive', 'balance-negative');
        elements.balance.classList.add(summary.balance >= 0 ? 'balance-positive' : 'balance-negative');
    }
}

function getFilterPopover() {
    if (filterPopover) return filterPopover;
    filterPopover = document.createElement('div');
    filterPopover.className = 'filter-popover';
    filterPopover.setAttribute('role', 'dialog');
    filterPopover.setAttribute('aria-label', '篩選選項');
    document.body.appendChild(filterPopover);
    return filterPopover;
}

function closeFilterPopover() {
    if (filterPopover) {
        filterPopover.classList.remove('is-open');
        filterPopoverAnchor = null;
    }
}

function openFilterPopover(btn) {
    if (filterPopoverAnchor === btn) {
        closeFilterPopover();
        return;
    }
    const kind = btn.getAttribute('data-filter'); // 'category' | 'payment'
    const list = transactionHistoryFull || [];
    const popover = getFilterPopover();
    popover.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'filter-popover__actions';
    const btnSelectAll = document.createElement('button');
    btnSelectAll.type = 'button';
    btnSelectAll.className = 'filter-popover__action';
    btnSelectAll.textContent = '全選';
    const btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.className = 'filter-popover__action';
    btnClear.textContent = '取消篩選';
    actions.appendChild(btnSelectAll);
    actions.appendChild(btnClear);
    popover.appendChild(actions);

    const listEl = document.createElement('div');
    listEl.className = 'filter-popover__list';
    popover.appendChild(listEl);

    if (kind === 'category') {
        const categories = [...new Set(list.map(t => (t.category && String(t.category).trim()) || '未分類').filter(Boolean))].sort();
        btnSelectAll.addEventListener('click', () => {
            selectedFilterCategories = categories.slice();
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
            applyTableFilter();
        });
        btnClear.addEventListener('click', () => {
            selectedFilterCategories = [];
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
            applyTableFilter();
        });
        categories.forEach(cat => {
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = cat;
            cb.checked = selectedFilterCategories.includes(cat);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!selectedFilterCategories.includes(cat)) selectedFilterCategories.push(cat);
                } else {
                    selectedFilterCategories = selectedFilterCategories.filter(c => c !== cat);
                }
                applyTableFilter();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(cat));
            listEl.appendChild(label);
        });
    } else if (kind === 'payment') {
        const paymentMethods = [...new Set(list.map(t => (t.paymentMethod && String(t.paymentMethod).trim()) || '其他').filter(Boolean))].sort();
        btnSelectAll.addEventListener('click', () => {
            selectedFilterPaymentMethods = paymentMethods.slice();
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
            applyTableFilter();
        });
        btnClear.addEventListener('click', () => {
            selectedFilterPaymentMethods = [];
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
            applyTableFilter();
        });
        paymentMethods.forEach(pm => {
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = pm;
            cb.checked = selectedFilterPaymentMethods.includes(pm);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!selectedFilterPaymentMethods.includes(pm)) selectedFilterPaymentMethods.push(pm);
                } else {
                    selectedFilterPaymentMethods = selectedFilterPaymentMethods.filter(p => p !== pm);
                }
                applyTableFilter();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(pm));
            listEl.appendChild(label);
        });
    }

    const rect = btn.getBoundingClientRect();
    popover.style.left = rect.left + 'px';
    popover.style.top = (rect.bottom + 4) + 'px';
    popover.classList.add('is-open');
    filterPopoverAnchor = btn;
}

function applyTableFilter() {
    const list = transactionHistoryFull || [];
    const filtered = list.filter(tx => {
        const cat = (tx.category && String(tx.category).trim()) || '未分類';
        const pm = (tx.paymentMethod && String(tx.paymentMethod).trim()) || '其他';
        return (selectedFilterCategories.length === 0 || selectedFilterCategories.includes(cat)) &&
               (selectedFilterPaymentMethods.length === 0 || selectedFilterPaymentMethods.includes(pm));
    });
    currentTransactions = filtered;
    renderTable(filtered);
}

function formatDateForDisplay(dateStr) {
    // 手機版（≤600px）只顯示月-日，桌面版顯示完整日期
    if (!dateStr) return '';
    const isMobile = window.innerWidth <= 600;
    if (!isMobile) return dateStr; // 桌面版顯示完整日期
    
    // 手機版：從 "2026-02-01" 格式中提取月-日（保留前導零）
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const month = parts[1];
        const day = parts[2];
        return `${month}-${day}`;
    }
    return dateStr;
}

function renderTable(history) {
    if(!elements.transactionList) return;
    currentTransactions = history || [];
    elements.transactionList.innerHTML = '';

    currentTransactions.forEach(tx => {
        const row = document.createElement('tr');
        row.className = 'transaction-row';
        row.setAttribute('data-id', escapeHtml(String(tx.id || '')));
        
        // 創建包含所有內容的 td（使用單個 td 包裝所有內容）
        const contentCell = document.createElement('td');
        contentCell.className = 'transaction-row-cell';
        contentCell.colSpan = 6;
        
        // 創建滑動容器
        const swipeContainer = document.createElement('div');
        swipeContainer.className = 'swipe-container';
        
        // 創建內容區域
        const content = document.createElement('div');
        content.className = 'swipe-content';
        const displayDate = formatDateForDisplay(tx.date);
        content.innerHTML = `
            <div class="cell-date">${escapeHtml(displayDate)}</div>
            <div class="cell-category"><span class="badge">${escapeHtml(tx.category)}</span></div>
            <div class="cell-item">${escapeHtml(tx.itemName)}</div>
            <div class="cell-payment">${escapeHtml(tx.paymentMethod)}</div>
            <div class="cell-amount">${formatMoney(tx.twdAmount)}</div>
            <div class="cell-actions row-actions">
                <button type="button" class="btn-edit" data-id="${escapeHtml(String(tx.id || ''))}" aria-label="編輯">
                    <svg class="icon-edit" aria-hidden="true"><use href="#icon-edit"></use></svg>
                </button>
                <button type="button" class="btn-delete" data-id="${escapeHtml(String(tx.id || ''))}" aria-label="刪除">
                    <svg class="icon-delete" aria-hidden="true"><use href="#icon-delete"></use></svg>
                </button>
            </div>
        `;
        
        // 創建編輯按鈕（放在左邊，右滑時顯示）
        const swipeEditAction = document.createElement('div');
        swipeEditAction.className = 'swipe-action swipe-action--edit';
        swipeEditAction.innerHTML = `
            <button type="button" class="swipe-action-btn swipe-action-btn--edit" data-id="${escapeHtml(String(tx.id || ''))}" aria-label="編輯">
                <svg class="icon-edit" aria-hidden="true"><use href="#icon-edit"></use></svg>
            </button>
        `;
        
        // 創建刪除按鈕（放在右邊，左滑時顯示）
        const swipeDeleteAction = document.createElement('div');
        swipeDeleteAction.className = 'swipe-action swipe-action--delete';
        swipeDeleteAction.innerHTML = `
            <button type="button" class="swipe-action-btn swipe-action-btn--delete" data-id="${escapeHtml(String(tx.id || ''))}" aria-label="刪除">
                <svg class="icon-delete" aria-hidden="true"><use href="#icon-delete"></use></svg>
            </button>
        `;
        
        // 組裝結構：[編輯] [內容] [刪除]
        // 左滑時內容向左 → 露出右邊的刪除
        // 右滑時內容向右 → 露出左邊的編輯
        swipeContainer.appendChild(swipeEditAction);
        swipeContainer.appendChild(content);
        swipeContainer.appendChild(swipeDeleteAction);
        contentCell.appendChild(swipeContainer);
        row.appendChild(contentCell);
        
        // 桌面版按鈕事件
        const editBtn = content.querySelector('.btn-edit');
        const delBtn = content.querySelector('.btn-delete');
        if (editBtn) editBtn.addEventListener('click', function () { startEdit(this.getAttribute('data-id')); });
        if (delBtn) delBtn.addEventListener('click', function () { deleteTransaction(this.getAttribute('data-id')); });
        
        // 滑動操作按鈕事件
        const swipeEditBtn = swipeEditAction.querySelector('.swipe-action-btn--edit');
        const swipeDelBtn = swipeDeleteAction.querySelector('.swipe-action-btn--delete');
        if (swipeEditBtn) swipeEditBtn.addEventListener('click', function () { 
            resetSwipeContainer(swipeContainer);
            startEdit(this.getAttribute('data-id')); 
        });
        if (swipeDelBtn) swipeDelBtn.addEventListener('click', function () { 
            resetSwipeContainer(swipeContainer);
            deleteTransaction(this.getAttribute('data-id')); 
        });
        
        // 添加滑動功能
        initSwipe(swipeContainer);
        
        // 添加點擊事件顯示詳細資訊
        content.addEventListener('click', (e) => {
            // 如果點擊的是按鈕，不顯示詳情
            if (e.target.closest('.btn-edit, .btn-delete')) return;
            // 如果容器處於滑動狀態，不顯示詳情
            if (swipeContainer.classList.contains('swiped-left') || swipeContainer.classList.contains('swiped-right')) return;
            
            showTransactionDetail(tx);
        });
        
        elements.transactionList.appendChild(row);
    });
}

// 當前打開的滑動容器（全域追蹤，確保一次只有一個）
let currentOpenSwipeContainer = null;

// 重置指定容器的滑動狀態
function resetSwipeContainer(container) {
    if (!container) return;
    const content = container.querySelector('.swipe-content');
    if (content) {
        content.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        content.style.transform = 'translateX(0)';
    }
    container.classList.remove('swiped-left', 'swiped-right');
    container._swipeState = { currentTranslate: 0, prevTranslate: 0 };
    if (currentOpenSwipeContainer === container) {
        currentOpenSwipeContainer = null;
    }
}

// 初始化滑動功能
function initSwipe(container) {
    if (!container) return;
    
    const content = container.querySelector('.swipe-content');
    if (!content) return;
    
    // 初始化滑動狀態
    container._swipeState = { currentTranslate: 0, prevTranslate: 0 };
    
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    
    function setTranslateX(x) {
        content.style.transform = `translateX(${x}px)`;
        container._swipeState.currentTranslate = x;
    }
    
    function resetSwipe() {
        container._swipeState.currentTranslate = 0;
        container._swipeState.prevTranslate = 0;
        content.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        setTranslateX(0);
        container.classList.remove('swiped-left', 'swiped-right');
        if (currentOpenSwipeContainer === container) {
            currentOpenSwipeContainer = null;
        }
    }
    
    function handleStart(e) {
        // 如果點擊的是按鈕，不處理滑動
        if (e.target.closest('.btn-edit, .btn-delete, .swipe-action-btn')) return;
        
        // 重置之前打開的容器
        if (currentOpenSwipeContainer && currentOpenSwipeContainer !== container) {
            resetSwipeContainer(currentOpenSwipeContainer);
        }
        
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        isDragging = true;
        content.style.transition = 'none';
        
        // 從狀態中讀取當前位置
        container._swipeState.prevTranslate = container._swipeState.currentTranslate;
    }
    
    function handleMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        
        const touch = e.touches ? e.touches[0] : e;
        currentX = touch.clientX - startX;
        const newTranslate = container._swipeState.prevTranslate + currentX;
        
        // 限制滑動範圍
        const maxLeft = -90; // 左滑最大距離（刪除按鈕寬度）
        const maxRight = 90; // 右滑最大距離（編輯按鈕寬度）
        const limitedTranslate = Math.max(maxLeft, Math.min(maxRight, newTranslate));
        
        setTranslateX(limitedTranslate);
    }
    
    function handleEnd() {
        if (!isDragging) return;
        isDragging = false;
        
        content.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        
        const threshold = 50; // 滑動閾值
        const actionWidth = 90; // 操作按鈕寬度
        const currentTranslate = container._swipeState.currentTranslate;
        
        if (currentTranslate < -threshold) {
            // 左滑：顯示刪除
            container._swipeState.currentTranslate = -actionWidth;
            container._swipeState.prevTranslate = -actionWidth;
            setTranslateX(-actionWidth);
            container.classList.add('swiped-left');
            container.classList.remove('swiped-right');
            currentOpenSwipeContainer = container;
        } else if (currentTranslate > threshold) {
            // 右滑：顯示編輯
            container._swipeState.currentTranslate = actionWidth;
            container._swipeState.prevTranslate = actionWidth;
            setTranslateX(actionWidth);
            container.classList.add('swiped-right');
            container.classList.remove('swiped-left');
            currentOpenSwipeContainer = container;
        } else {
            // 未達閾值：彈回原位
            resetSwipe();
        }
    }
    
    // 觸摸事件
    content.addEventListener('touchstart', handleStart, { passive: false });
    content.addEventListener('touchmove', handleMove, { passive: false });
    content.addEventListener('touchend', handleEnd, { passive: true });
    
    // 點擊內容區域重置滑動
    content.addEventListener('click', (e) => {
        if (container.classList.contains('swiped-left') || container.classList.contains('swiped-right')) {
            // 如果點擊的是按鈕，不重置
            if (e.target.closest('.btn-edit, .btn-delete')) return;
            e.preventDefault();
            resetSwipe();
        }
    });
}


/**
 * 進入編輯模式：依 id 從 currentTransactions 取出資料填入表單，按鈕改為「更新交易」，並捲至表單。
 */
function startEdit(id) {
    const tx = currentTransactions.find(function (t) { return t.id === id || String(t.id) === String(id); });
    if (!tx) return;

    if (elements.dateInput) elements.dateInput.value = tx.date || '';
    if (elements.itemInput) elements.itemInput.value = tx.itemName || '';
    // 編輯時：格式化顯示金額（加上千分位逗號）
    if (elements.amountInput) {
        const amountValue = tx.originalAmount != null ? tx.originalAmount : (tx.twdAmount != null ? tx.twdAmount : '');
        if (amountValue) {
            elements.amountInput.value = formatNumberWithCommas(String(amountValue));
        } else {
            elements.amountInput.value = '';
        }
    }
    const currencyVal = (tx.currency || 'TWD').toUpperCase();
    if (elements.currencyInput) {
        if (!Array.from(elements.currencyInput.options).some(function (o) { return o.value === currencyVal; })) {
            const opt = document.createElement('option');
            opt.value = currencyVal;
            opt.textContent = currencyVal;
            elements.currencyInput.appendChild(opt);
        }
        elements.currencyInput.value = currencyVal;
    }
    if (elements.noteInput) elements.noteInput.value = tx.note || '';

    const cat = String(tx.category || '');
    if (elements.categorySelect) {
        if (!Array.from(elements.categorySelect.options).some(function (o) { return o.value === cat; })) {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            elements.categorySelect.appendChild(opt);
        }
        elements.categorySelect.value = cat;
    }
    const pay = String(tx.paymentMethod || '');
    if (elements.methodInput) {
        if (!Array.from(elements.methodInput.options).some(function (o) { return o.value === pay; })) {
            const opt = document.createElement('option');
            opt.value = pay;
            opt.textContent = pay;
            elements.methodInput.appendChild(opt);
        }
        elements.methodInput.value = pay;
    }

    editingId = id;
    if (elements.addBtn) elements.addBtn.innerText = '更新交易';
    if (elements.cancelEditBtn) elements.cancelEditBtn.style.display = 'block';
    if (elements.formSectionTitle) elements.formSectionTitle.textContent = '編輯交易';

    const form = document.getElementById('transactionForm');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
}

// =========================================
// renderChart(history) — Category Doughnut + categoryStats list
// =========================================
function renderChart(history, incomeCategories) {
    const canvas = elements.categoryChart;
    const statsEl = elements.categoryStats;
    if (!canvas) return;

    // Group by category, sum twdAmount (use Math.abs for consistent positive segment sizes)
    const byCat = {};
    const incomeSet = new Set(incomeCategories || []);
    (history || []).forEach((tx) => {
        const rawCat = tx.category && String(tx.category).trim() ? tx.category : '未分類';
        // 僅統計「支出」分類：收入類別（如薪水、投資）不列入圓餅圖
        if (incomeSet.has(rawCat)) return;
        const cat = rawCat;
        const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
        byCat[cat] = (byCat[cat] || 0) + amt;
    });

    const labels = Object.keys(byCat);
    const pairs = labels.map((l) => ({ label: l, value: byCat[l] })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    // Destroy previous chart to prevent canvas glitching when switching months
    if (expenseChart) {
        expenseChart.destroy();
        expenseChart = null;
    }

    var legendEl = document.getElementById('categoryChartLegend');
    if (legendEl) legendEl.innerHTML = '';

    // categoryStats: HTML list "Category: Amount" sorted by value
    if (statsEl) {
        if (pairs.length === 0) {
            statsEl.innerHTML = '<p class="category-stats-empty">本月尚無消費資料</p>';
        } else {
            statsEl.innerHTML =
                '<ul class="category-stats-list">' +
                pairs.map((p) => `<li><span class="cat-name">${escapeHtml(p.label)}</span><span class="cat-amount">${formatMoney(p.value)}</span></li>`).join('') +
                '</ul>';
        }
    }

    // Doughnut: only create when there is data
    if (pairs.length === 0) return;

    const chartLabels = pairs.map((p) => p.label);
    const chartData = pairs.map((p) => Math.abs(p.value));
    const colors = chartData.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    const ctx = canvas.getContext('2d');
    expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartData,
                backgroundColor: colors,
                borderColor: '#fff',
                borderWidth: 2,
                hoverOffset: 6,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            layout: {
                padding: 8, // 內縮一點，避免 hover 放大時被裁切
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        // 標題行留空，避免重複顯示兩次分類名稱
                        title: function () { return ''; },
                        // Tooltip 僅顯示百分比（相對於總支出）
                        label: function (context) {
                            const label = context.label || '';
                            const dataArr = context.dataset.data || [];
                            const total = dataArr.reduce((sum, v) => sum + Math.abs(v || 0), 0);
                            const value = Math.abs(dataArr[context.dataIndex] || 0);
                            const pct = total ? (value / total) * 100 : 0;
                            return `${label}: ${pct.toFixed(1)}%`;
                        },
                    },
                },
            },
        },
    });

    // 自訂圖例（類別＝顏色）：一排四個
    if (legendEl) {
        legendEl.innerHTML = chartLabels.map(function (l, i) {
            return '<span class="legend-item"><span class="legend-color" style="background:' + colors[i] + '"></span>' + escapeHtml(l) + '</span>';
        }).join('');
    }
}

function renderPaymentStats(history) {
    const el = elements.paymentStats;
    if (!el) return;
    const byMethod = {};
    (history || []).forEach((tx) => {
        const m = tx.paymentMethod && String(tx.paymentMethod).trim() ? tx.paymentMethod : '其他';
        const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
        byMethod[m] = (byMethod[m] || 0) + amt;
    });
    const pairs = Object.keys(byMethod)
        .map((k) => ({ label: k, value: byMethod[k] }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    if (pairs.length === 0) {
        el.innerHTML = '<p class="payment-stats-empty">本月尚無消費紀錄</p>';
    } else {
        el.innerHTML =
            '<ul class="payment-stats-list">' +
            pairs.map((p) => `<li><span class="pay-name">${escapeHtml(p.label)}</span><span class="pay-amount">${formatMoney(p.value)}</span></li>`).join('') +
            '</ul>';
    }
}

function populateCategories(data) {
    if (!elements.categorySelect) return;
    var expense = (data && data.categoriesExpense) || [];
    var income = (data && data.categoriesIncome) || [];
    var flat = (data && data.categories) || [];
    elements.categorySelect.innerHTML = '<option value="" disabled selected>選擇類別</option>';
    if (expense.length > 0 || income.length > 0) {
        if (expense.length > 0) {
            var g1 = document.createElement('optgroup');
            g1.label = '支出';
            expense.forEach(function (c) {
                var o = document.createElement('option');
                o.value = c;
                o.textContent = c;
                g1.appendChild(o);
            });
            elements.categorySelect.appendChild(g1);
        }
        if (income.length > 0) {
            var g2 = document.createElement('optgroup');
            g2.label = '收入';
            income.forEach(function (c) {
                var o = document.createElement('option');
                o.value = c;
                o.textContent = c;
                g2.appendChild(o);
            });
            elements.categorySelect.appendChild(g2);
        }
    } else {
        flat.forEach(function (c) {
            var o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            elements.categorySelect.appendChild(o);
        });
    }
}

/**
 * 從 Accounts 分頁的 Account Name 填入支付方式選單；每次 fetch 都會執行以與試算表同步。
 */
function populatePaymentMethods(accounts) {
    const sel = elements.methodInput;
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>選擇支付方式</option>';
    (accounts || []).forEach((acc) => {
        const name = acc.accountName && String(acc.accountName).trim();
        if (name) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        }
    });
    if (prev && Array.from(sel.options).some(function (o) { return o.value === prev; })) sel.value = prev;
}

function initMonthSelector() {
    if (!elements.monthSelect) return;
    elements.monthSelect.innerHTML = '';
    const today = new Date();
    // Generate last 6 months
    for(let i = 0; i < 6; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const option = document.createElement('option');
        option.value = `${y}-${m}`;
        option.innerText = `${y}年 ${m}月`;
        elements.monthSelect.appendChild(option);
    }
    // Select current month
    elements.monthSelect.value = `${currentYear}-${currentMonth}`;
}

/**
 * 從中央匯率表載入可用幣別並填入 #currency 選單；失敗時保留 TWD。
 */
async function loadCurrencyOptions() {
    const sel = elements.currencyInput;
    if (!sel) return;

    const supabase = getSupabase();
    if (!supabase) {
        sel.innerHTML = '<option value="TWD" selected>TWD</option>';
        return;
    }

    try {
        const { data: codes, error } = await supabase.rpc('get_available_currencies');
        const list = Array.isArray(codes) ? codes : (codes ? [codes] : []);
        if (error || list.length === 0) {
            sel.innerHTML = '<option value="TWD" selected>TWD</option>';
            return;
        }
        sel.innerHTML = '';
        const hasTWD = list.some(function (c) { return String(c).toUpperCase() === 'TWD'; });
        if (!hasTWD) list.unshift('TWD');
        list.forEach(function (code) {
            const opt = document.createElement('option');
            opt.value = String(code).toUpperCase();
            opt.textContent = String(code).toUpperCase();
            if (opt.value === 'TWD') opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (e) {
        sel.innerHTML = '<option value="TWD" selected>TWD</option>';
    }
}

/**
 * 大螢幕（>1200px）時：高度由 CSS Grid 自動控制，不需要 JS 動態調整。
 * 右側儀表板可以隨畫面高度自由滾動。
 */
function syncDashboardHeightToForm() {
    // 移除所有動態高度設定，讓 CSS Grid 自動處理
    const dashboardColumn = elements.dashboardColumn;
    if (dashboardColumn && window.innerWidth <= 1200) {
        dashboardColumn.style.maxHeight = '';
    }
}

function formatMoney(num) {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0 }).format(num);
}

function escapeHtml(s) {
    if (s == null) return '';
    const t = String(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setLoading(isLoading) {
    document.body.style.cursor = isLoading ? 'wait' : 'default';
    if (elements.monthSelect) elements.monthSelect.disabled = !!isLoading;
}

// 為 OAuth 用戶建立預設資料（與 auth.html 中的函數相同）
async function createDefaultDataForOAuth(userId) {
    // 取得 supabase client
    const supabase = getSupabase();
    if (!supabase) {
        console.error('Supabase 尚未初始化');
        return;
    }
    
    try {
        // 建立預設帳戶
        const { error: accountsError } = await supabase
            .from('accounts')
            .insert([
                { user_id: userId, name: '現金', type: 'cash' },
                { user_id: userId, name: '信用卡A', type: 'credit_card', credit_limit: 50000, billing_day: 5, payment_due_day: 25 }
            ]);

        if (accountsError) console.error('建立預設帳戶失敗:', accountsError);

        // 建立預設設定
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

// =========================================
// Settings Management Modal
// =========================================

// State
let currentExpenseCategories = [];
let currentIncomeCategories = [];
let currentAccounts = [];

// DOM elements
const settingsModal = document.getElementById('settingsManageModal');
const settingsManageBtn = document.getElementById('settingsManageBtn');
const settingsCloseBtn = document.getElementById('settingsManageCloseBtn');
const expenseCategoryList = document.getElementById('expenseCategoryList');
const incomeCategoryList = document.getElementById('incomeCategoryList');
const accountsList = document.getElementById('accountsList');
const addAccountBtn = document.getElementById('addAccountBtn');
const accountForm = document.getElementById('accountForm');
const accountFormElement = document.getElementById('accountFormElement');
const cancelAccountFormBtn = document.getElementById('cancelAccountFormBtn');
const accountTypeSelect = document.getElementById('accountType');
const creditCardFields = document.getElementById('creditCardFields');

// 開啟 Modal
function openSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add('is-open');
    settingsModal.setAttribute('aria-hidden', 'false');
    loadSettingsData();
}

// 關閉 Modal
function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.remove('is-open');
    settingsModal.setAttribute('aria-hidden', 'true');
    // 關閉後重新載入資料以更新下拉選單
    fetchDashboardData(currentYear, currentMonth);
}

// 載入設定資料
async function loadSettingsData() {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // 載入類別
        const { data: expenseData } = await supabase
            .from('settings')
            .select('value')
            .eq('user_id', user.id)
            .eq('key', 'expense_categories')
            .single();

        const { data: incomeData } = await supabase
            .from('settings')
            .select('value')
            .eq('user_id', user.id)
            .eq('key', 'income_categories')
            .single();

        currentExpenseCategories = (expenseData?.value || ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他']);
        currentIncomeCategories = (incomeData?.value || ['薪水', '投資', '其他']);

        renderCategories();

        // 載入帳戶
        const { data: accounts } = await supabase
            .from('accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });

        currentAccounts = accounts || [];
        renderAccounts();
    } catch (error) {
        console.error('載入設定資料失敗:', error);
    }
}

// 渲染類別列表
function renderCategories() {
    if (!expenseCategoryList || !incomeCategoryList) return;

    // 支出類別
    expenseCategoryList.innerHTML = currentExpenseCategories.map((cat, index) => `
        <li class="category-item">
            <span class="category-item__name">${escapeHtml(cat)}</span>
            <div class="category-item__actions">
                <button type="button" class="category-item__btn" onclick="renameCategoryPrompt('expense', ${index})">重新命名</button>
                <button type="button" class="category-item__btn category-item__btn--delete" onclick="deleteCategory('expense', ${index})">刪除</button>
            </div>
        </li>
    `).join('');

    // 收入類別
    incomeCategoryList.innerHTML = currentIncomeCategories.map((cat, index) => `
        <li class="category-item">
            <span class="category-item__name">${escapeHtml(cat)}</span>
            <div class="category-item__actions">
                <button type="button" class="category-item__btn" onclick="renameCategoryPrompt('income', ${index})">重新命名</button>
                <button type="button" class="category-item__btn category-item__btn--delete" onclick="deleteCategory('income', ${index})">刪除</button>
            </div>
        </li>
    `).join('');
}

// 新增類別
async function addCategory(type) {
    const name = prompt(type === 'expense' ? '請輸入新的支出類別名稱：' : '請輸入新的收入類別名稱：');
    if (!name || !name.trim()) return;

    const trimmedName = name.trim();
    const categories = type === 'expense' ? currentExpenseCategories : currentIncomeCategories;

    if (categories.includes(trimmedName)) {
        alert('此類別已存在！');
        return;
    }

    categories.push(trimmedName);
    await saveCategoriesType(type);
}

// 重新命名類別
async function renameCategoryPrompt(type, index) {
    const categories = type === 'expense' ? currentExpenseCategories : currentIncomeCategories;
    const oldName = categories[index];
    const newName = prompt('請輸入新的類別名稱：', oldName);
    
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    const trimmedName = newName.trim();
    
    if (categories.includes(trimmedName)) {
        alert('此類別名稱已存在！');
        return;
    }

    categories[index] = trimmedName;
    await saveCategoriesType(type);

    // 更新所有使用此類別的交易
    await updateTransactionCategories(oldName, trimmedName);
}

// 刪除類別
async function deleteCategory(type, index) {
    const categories = type === 'expense' ? currentExpenseCategories : currentIncomeCategories;
    const categoryName = categories[index];
    
    if (!confirm(`確定要刪除類別「${categoryName}」嗎？\n\n注意：既有交易的類別名稱會保留。`)) return;

    categories.splice(index, 1);
    await saveCategoriesType(type);
}

// 暴露到全局作用域供 HTML onclick 使用
window.addCategory = addCategory;
window.renameCategoryPrompt = renameCategoryPrompt;
window.deleteCategory = deleteCategory;

// 儲存類別
async function saveCategoriesType(type) {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const key = type === 'expense' ? 'expense_categories' : 'income_categories';
        const value = type === 'expense' ? currentExpenseCategories : currentIncomeCategories;

        const { error } = await supabase
            .from('settings')
            .upsert({
                user_id: user.id,
                key: key,
                value: value
            });

        if (error) throw error;

        renderCategories();
    } catch (error) {
        console.error('儲存類別失敗:', error);
        alert('儲存失敗，請稍後再試。');
    }
}

// 更新交易的類別名稱（批次更新）
async function updateTransactionCategories(oldName, newName) {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from('transactions')
            .update({ category: newName })
            .eq('user_id', user.id)
            .eq('category', oldName);

        if (error) throw error;
    } catch (error) {
        console.error('更新交易類別失敗:', error);
    }
}

// 渲染帳戶列表
function renderAccounts() {
    if (!accountsList) return;

    if (currentAccounts.length === 0) {
        accountsList.innerHTML = '<p style="color: var(--color-text-secondary); text-align: center; padding: 1rem;">尚無帳戶，請新增帳戶。</p>';
        return;
    }

    accountsList.innerHTML = currentAccounts.map(account => {
        const typeNames = {
            'cash': '現金',
            'credit_card': '信用卡',
            'debit_card': '金融卡',
            'digital_wallet': '電子錢包',
            'bank': '銀行帳戶'
        };

        let details = `<div class="account-item__detail">類型：${typeNames[account.type] || account.type}</div>`;
        
        if (account.type === 'credit_card') {
            if (account.credit_limit) {
                details += `<div class="account-item__detail">信用額度：${formatMoney(account.credit_limit)}</div>`;
            }
            if (account.billing_day) {
                details += `<div class="account-item__detail">帳單日：每月 ${account.billing_day} 日</div>`;
            }
            if (account.payment_due_day) {
                details += `<div class="account-item__detail">繳款日：每月 ${account.payment_due_day} 日</div>`;
            }
        }

        return `
            <div class="account-item">
                <div class="account-item__header">
                    <span class="account-item__name">${escapeHtml(account.name)}</span>
                    <div class="account-item__actions">
                        <button type="button" class="account-item__btn" onclick="editAccount('${account.id}')">編輯</button>
                        <button type="button" class="account-item__btn account-item__btn--delete" onclick="deleteAccount('${account.id}')">刪除</button>
                    </div>
                </div>
                <div class="account-item__details">
                    ${details}
                </div>
            </div>
        `;
    }).join('');
}

// 新增帳戶
function showAddAccountForm() {
    if (!accountForm || !accountFormElement) return;
    
    document.getElementById('accountFormTitle').textContent = '新增帳戶';
    document.getElementById('accountFormId').value = '';
    document.getElementById('accountName').value = '';
    document.getElementById('accountType').value = '';
    document.getElementById('creditLimit').value = '';
    document.getElementById('billingDay').value = '';
    document.getElementById('paymentDueDay').value = '';
    
    creditCardFields.style.display = 'none';
    accountForm.style.display = 'block';
    accountsList.style.display = 'none';
}

// 編輯帳戶
function editAccount(accountId) {
    if (!accountForm || !accountFormElement) return;
    
    const account = currentAccounts.find(a => a.id === accountId);
    if (!account) return;

    document.getElementById('accountFormTitle').textContent = '編輯帳戶';
    document.getElementById('accountFormId').value = account.id;
    document.getElementById('accountName').value = account.name;
    document.getElementById('accountType').value = account.type;
    document.getElementById('creditLimit').value = account.credit_limit || '';
    document.getElementById('billingDay').value = account.billing_day || '';
    document.getElementById('paymentDueDay').value = account.payment_due_day || '';
    
    creditCardFields.style.display = account.type === 'credit_card' ? 'block' : 'none';
    accountForm.style.display = 'block';
    accountsList.style.display = 'none';
}

// 取消帳戶表單
function cancelAccountForm() {
    if (!accountForm) return;
    accountForm.style.display = 'none';
    accountsList.style.display = 'block';
}

// 儲存帳戶
async function saveAccount(e) {
    e.preventDefault();
    
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const accountId = document.getElementById('accountFormId').value;
        const name = document.getElementById('accountName').value.trim();
        const type = document.getElementById('accountType').value;
        const creditLimit = document.getElementById('creditLimit').value;
        const billingDay = document.getElementById('billingDay').value;
        const paymentDueDay = document.getElementById('paymentDueDay').value;

        if (!name || !type) {
            alert('請填寫必填欄位！');
            return;
        }

        const accountData = {
            user_id: user.id,
            name: name,
            type: type,
            credit_limit: creditLimit ? parseFloat(creditLimit) : null,
            billing_day: billingDay ? parseInt(billingDay) : null,
            payment_due_day: paymentDueDay ? parseInt(paymentDueDay) : null
        };

        if (accountId) {
            // 更新
            const oldAccount = currentAccounts.find(a => a.id === accountId);
            const oldName = oldAccount?.name;

            const { error } = await supabase
                .from('accounts')
                .update(accountData)
                .eq('id', accountId);

            if (error) throw error;

            // 如果名稱改變，更新交易的 payment_method
            if (oldName && oldName !== name) {
                await updateTransactionPaymentMethods(oldName, name);
            }
        } else {
            // 新增
            const { error } = await supabase
                .from('accounts')
                .insert(accountData);

            if (error) throw error;
        }

        cancelAccountForm();
        await loadSettingsData();
    } catch (error) {
        console.error('儲存帳戶失敗:', error);
        alert('儲存失敗，請稍後再試。');
    }
}

// 刪除帳戶
async function deleteAccount(accountId) {
    const account = currentAccounts.find(a => a.id === accountId);
    if (!account) return;

    if (!confirm(`確定要刪除帳戶「${account.name}」嗎？\n\n注意：既有交易的支付方式名稱會保留，但帳戶連結會移除。`)) return;

    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { error } = await supabase
            .from('accounts')
            .delete()
            .eq('id', accountId);

        if (error) throw error;

        await loadSettingsData();
    } catch (error) {
        console.error('刪除帳戶失敗:', error);
        alert('刪除失敗，請稍後再試。');
    }
}

// 暴露到全局作用域供 HTML onclick 使用
window.editAccount = editAccount;
window.deleteAccount = deleteAccount;

// 更新交易的支付方式名稱（批次更新）
async function updateTransactionPaymentMethods(oldName, newName) {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from('transactions')
            .update({ payment_method: newName })
            .eq('user_id', user.id)
            .eq('payment_method', oldName);

        if (error) throw error;
    } catch (error) {
        console.error('更新交易支付方式失敗:', error);
    }
}

// 事件監聽
function openSettingsModalAndCloseMenu() {
    // 關閉桌面版與手機版更多選單
    const moreMenuDropdown = document.getElementById('moreMenuDropdown');
    const moreMenuDropdownMobile = document.getElementById('moreMenuDropdownMobile');
    if (moreMenuDropdown) moreMenuDropdown.classList.remove('is-open');
    if (moreMenuDropdownMobile) moreMenuDropdownMobile.classList.remove('is-open');
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
}

// 類別新增按鈕
document.querySelectorAll('.btn-add-category').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.target.getAttribute('data-type');
        addCategory(type);
    });
});

// 帳戶相關按鈕
if (addAccountBtn) {
    addAccountBtn.addEventListener('click', showAddAccountForm);
}

if (cancelAccountFormBtn) {
    cancelAccountFormBtn.addEventListener('click', cancelAccountForm);
}

if (accountFormElement) {
    accountFormElement.addEventListener('submit', saveAccount);
}

// 帳戶類型改變時顯示/隱藏信用卡欄位
if (accountTypeSelect) {
    accountTypeSelect.addEventListener('change', (e) => {
        creditCardFields.style.display = e.target.value === 'credit_card' ? 'block' : 'none';
    });
}