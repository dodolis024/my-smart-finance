/**
 * Smart Expense Tracker - Frontend Logic
 */

// ⚠️ PASTE YOUR GOOGLE APPS SCRIPT URL HERE
const API_URL = "https://script.google.com/macros/s/AKfycbxcsTTeOVdetgiKb3gghfkgTcK5iI043_yhbPe2V5AaKxj54DVZbsH73sXPqfK7oIF6BQ/exec";
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
    reactionCloseBtn: document.getElementById('reactionCloseBtn')
};

// Chart.js instance for category doughnut (destroy before re-create when switching months)
let expenseChart = null;

// State: 目前畫面上的交易列表；編輯模式時為該筆 id
let currentTransactions = [];
let editingId = null;
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

// Professional color palette for chart segments
const CHART_COLORS = [
    'rgba(99, 102, 241, 0.9)',   // indigo
    'rgba(34, 197, 94, 0.9)',    // green
    'rgba(234, 179, 8, 0.9)',    // amber
    'rgba(239, 68, 68, 0.9)',    // red
    'rgba(236, 72, 153, 0.9)',   // pink
    'rgba(20, 184, 166, 0.9)',   // teal
    'rgba(168, 85, 247, 0.9)',   // purple
    'rgba(249, 115, 22, 0.9)',   // orange
    'rgba(59, 130, 246, 0.9)',   // blue
];

// =========================================
// 1. Initialization
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    // Set Date input to today
    const today = new Date().toISOString().split('T')[0];
    if(elements.dateInput) elements.dateInput.value = today;

    // Load Month Selector (Optional: Simple last 6 months)
    initMonthSelector();

    // Fetch Initial Data
    fetchDashboardData(currentYear, currentMonth);

    // Attach Event Listeners（表單用 submit + preventDefault，避免 type="submit" 造成頁面重載）
    const form = document.getElementById('transactionForm');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitTransaction(); });
    if (elements.cancelEditBtn) elements.cancelEditBtn.addEventListener('click', resetEditState);
    if (elements.monthSelect) elements.monthSelect.addEventListener('change', (e) => {
        resetEditState();
        const [y, m] = e.target.value.split('-');
        fetchDashboardData(y, m);
    });

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
        if (e.key === 'Escape') closeReactionModal();
    });
});

// =========================================
// 2. Fetch Data (GET)
// =========================================
async function fetchDashboardData(year, month) {
    try {
        setLoading(true);
        console.log(`Fetching data for ${year}-${month}...`);
        
        const response = await fetch(`${API_URL}?action=getDashboardData&year=${year}&month=${month}`);
        if (!response.ok) throw new Error('伺服器錯誤 ' + response.status);
        const data = await response.json();
        if (!data.success) throw new Error(data.error);

        // A. Update Stats Cards
        updateStats(data.summary);

        // A2. Daily Streak（從後端帶回 streakCount / streakBroken，更新右上角 icon 與後續彈窗判斷）
        updateStreakStateFromServer(data);
        // NOTE: 首次載入頁面時：若 streak 斷掉，在當日第一個進站時彈出「生氣」視窗（一天只提醒一次）
        if (!streakInitialHandled) {
            streakInitialHandled = true;
            maybeShowBrokenModalOnLoad();
        }

        // B. Update Transaction Table
        renderTable(data.history);

        // C. Update Category Chart & Stats
        renderChart(data.history);

        // D. Update Payment Stats
        renderPaymentStats(data.history);

        // E. Update Categories (Only if empty)
        if (elements.categorySelect && elements.categorySelect.options.length <= 1) {
            populateCategories(data);
        }

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
    const loggedDates = Array.isArray(data && data.loggedDates) ? data.loggedDates.slice() : [];

    streakState.count = count;
    streakState.broken = broken;
    streakState.totalDays = totalDays;
    streakState.longestStreak = longestStreak;
    streakState.loggedDates = loggedDates;
    updateStreakBadge();
}

function updateStreakBadge() {
    if (!elements.streakBadge) return;
    const count = streakState.count || 0;
    let iconHtml = '';
    if (streakState.broken) {
        iconHtml = '💢';
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
    let title = '真乖呦！';
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
        title: '你偷懶被抓到了！！！',
        text: '吼呦！你昨天迷有記帳 氣鼠了！😡',
        buttonLabel: '我現在補記！',
        variant: 'broken'
    });
}

// 使用者點右上角小 icon 時：打開一個「總覽」視窗，顯示目前 streak 狀態
function openStreakModalForCurrent() {
    const count = streakState.count || 0;
    renderStreakCalendar();
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
    return new Date().toISOString().split('T')[0];
}

// NOTE: renderStreakCalendar
// - 依據 streakState.loggedDates 在 modal 內渲染「可切換月份」的日曆與下方三個統計卡片
// - 只負責畫面，不處理彈窗開關邏輯（開關由 openReactionModal 處理）
function renderStreakCalendar() {
    if (!elements.streakCalendarRoot) return;

    ensureStreakCalendarMonth();

    const y = streakCalendarYear;
    const m = streakCalendarMonth;

    // 產生一個 Set 方便查詢該月哪些日期有記帳
    const loggedSet = new Set(streakState.loggedDates || []);

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
        const hasLog = loggedSet.has(dateStr);
        const isToday = dateStr === todayStr;

        let cls = 'streak-calendar__day';
        if (hasLog) cls += ' streak-calendar__day--has-log';
        if (isToday) cls += ' streak-calendar__day--today';

        html += `<div class="${cls}"><div class="streak-calendar__day-inner">${d}</div></div>`;
    }

    html += '  </div>'; // grid
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

// 若尚未指定日曆的年月，則以「最新有記帳的日期」或「今天」作為起始月份
function ensureStreakCalendarMonth() {
    if (streakCalendarYear && streakCalendarMonth) return;
    let baseDate = null;
    if (streakState.loggedDates && streakState.loggedDates.length > 0) {
        // 取最新一筆記帳日期
        const sorted = streakState.loggedDates.slice().sort((a, b) => b.localeCompare(a));
        baseDate = new Date(sorted[0] + 'T12:00:00');
    } else {
        baseDate = new Date();
    }
    streakCalendarYear = baseDate.getFullYear();
    streakCalendarMonth = baseDate.getMonth() + 1;
}

function openReactionModal(opts) {
    if (!elements.reactionModal) return;
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

function focusTransactionInput() {
    const form = document.getElementById('transactionForm');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
    if (elements.itemInput) {
        setTimeout(() => elements.itemInput.focus(), 150);
    }
}

// =========================================
// 3. Submit Data (POST)
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

    const payload = {
        date: elements.dateInput.value,
        item: elements.itemInput.value,
        category: elements.categorySelect.value,
        method: elements.methodInput.value,
        currency: elements.currencyInput.value,
        amount: elements.amountInput.value,
        note: elements.noteInput.value
    };
    if (editingId) {
        payload.action = 'edit';
        payload.id = editingId;
    } else {
        payload.action = 'add';
    }

    try {
        const btn = elements.addBtn;
        const originalText = btn.innerText;
        btn.innerText = "儲存中...";
        btn.disabled = true;

        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('伺服器錯誤 ' + response.status);
        const result = await response.json();

        if (result.success) {
            const wasEdit = !!editingId;
            const submittedDate = elements.dateInput.value;
            const [y, m] = submittedDate ? submittedDate.split('-') : (elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [String(currentYear), String(currentMonth)]);
            resetEditState();
            await fetchDashboardData(parseInt(y, 10), parseInt(m, 10));
            // 新增當日第一筆資料後彈出「開心」視窗；編輯不觸發
            if (!wasEdit) {
                maybeShowPositiveModalAfterAdd(submittedDate);
            }
            alert(wasEdit ? '已更新。' : '記帳成功！');
        } else {
            throw new Error(result.error || 'Unknown error');
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
 * 刪除一筆交易：確認後 POST { action: 'delete', id }，成功則重整儀表板。
 */
async function deleteTransaction(id) {
    if (!id) return;
    if (!confirm('確定要刪除這筆交易嗎？')) return;

    try {
        setLoading(true);
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'delete', id: id })
        });
        if (!response.ok) throw new Error('伺服器錯誤 ' + response.status);
        const result = await response.json();

        if (result.success) {
            const v = elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [currentYear, currentMonth];
            await fetchDashboardData(parseInt(v[0], 10), parseInt(v[1], 10));
            alert('已刪除。');
        } else {
            throw new Error(result.error || '刪除失敗');
        }
    } catch (error) {
        console.error('Error deleting:', error);
        alert(error.message || '刪除失敗，請稍後再試。');
    } finally {
        setLoading(false);
    }
}

/**
 * 清除編輯狀態並還原表單：用於取消、送出成功、切換月份時。
 */
function resetEditState() {
    editingId = null;
    const today = new Date().toISOString().split('T')[0];
    if (elements.dateInput) elements.dateInput.value = today;
    if (elements.itemInput) elements.itemInput.value = '';
    if (elements.amountInput) elements.amountInput.value = '';
    if (elements.noteInput) elements.noteInput.value = '';
    if (elements.categorySelect) elements.categorySelect.value = '';
    if (elements.methodInput) elements.methodInput.value = '';
    if (elements.addBtn) elements.addBtn.innerText = '新增交易';
    if (elements.cancelEditBtn) elements.cancelEditBtn.style.display = 'none';
    if (elements.formSectionTitle) elements.formSectionTitle.textContent = '新增交易';
}

// =========================================
// 4. Helper Functions
// =========================================

function updateStats(summary) {
    if(elements.totalIncome) elements.totalIncome.innerText = formatMoney(summary.totalIncome);
    if(elements.totalExpense) elements.totalExpense.innerText = formatMoney(summary.totalExpense);
    if(elements.balance) elements.balance.innerText = formatMoney(summary.balance);
    
    // Optional: Color the balance
    if (elements.balance) {
        elements.balance.classList.remove('balance-positive', 'balance-negative');
        elements.balance.classList.add(summary.balance >= 0 ? 'balance-positive' : 'balance-negative');
    }
}

function renderTable(history) {
    if(!elements.transactionList) return;
    currentTransactions = history || [];
    elements.transactionList.innerHTML = '';

    currentTransactions.forEach(tx => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(tx.date)}</td>
            <td><span class="badge">${escapeHtml(tx.category)}</span></td>
            <td>${escapeHtml(tx.itemName)}</td>
            <td>${escapeHtml(tx.paymentMethod)}</td>
            <td class="amount">${formatMoney(tx.twdAmount)}</td>
            <td class="row-actions">
                <button type="button" class="btn-edit" data-id="${escapeHtml(String(tx.id || ''))}">編輯</button>
                <button type="button" class="btn-delete" data-id="${escapeHtml(String(tx.id || ''))}">刪除</button>
            </td>
        `;
        const editBtn = row.querySelector('.btn-edit');
        const delBtn = row.querySelector('.btn-delete');
        if (editBtn) editBtn.addEventListener('click', function () { startEdit(this.getAttribute('data-id')); });
        if (delBtn) delBtn.addEventListener('click', function () { deleteTransaction(this.getAttribute('data-id')); });
        elements.transactionList.appendChild(row);
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
    if (elements.amountInput) elements.amountInput.value = tx.originalAmount != null ? tx.originalAmount : (tx.twdAmount != null ? tx.twdAmount : '');
    if (elements.currencyInput) elements.currencyInput.value = tx.currency || 'TWD';
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
function renderChart(history) {
    const canvas = elements.categoryChart;
    const statsEl = elements.categoryStats;
    if (!canvas) return;

    // Group by category, sum twdAmount (use Math.abs for consistent positive segment sizes)
    const byCat = {};
    (history || []).forEach((tx) => {
        const cat = tx.category && String(tx.category).trim() ? tx.category : '未分類';
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
            statsEl.innerHTML = '<p class="category-stats-empty">本月尚無分類資料</p>';
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
            plugins: {
                legend: { display: false },
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
        el.innerHTML = '<p class="payment-stats-empty">本月尚無支付方式資料</p>';
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