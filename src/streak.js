/**
 * Smart Expense Tracker - 連續記帳 (Streak) 功能
 */

function moveStreakBadgeToTopBar() {
    const streakBadge = document.getElementById('streakBadge');
    const topBarRight = document.querySelector('.app-top-bar__right');

    if (!streakBadge || !topBarRight) return;

    if (!streakBadgeOriginalParent && streakBadge.parentElement !== topBarRight) {
        streakBadgeOriginalParent = streakBadge.parentElement;
    }

    const isVertical = window.matchMedia(`(max-width: ${LAYOUT.VERTICAL_MAX_WIDTH}px)`).matches;

    if (isVertical) {
        if (streakBadge.parentElement !== topBarRight) {
            topBarRight.appendChild(streakBadge);
        }
    } else {
        if (streakBadgeOriginalParent && streakBadge.parentElement !== streakBadgeOriginalParent) {
            const moreMenuBtn = streakBadgeOriginalParent.querySelector('.more-menu-btn--desktop');
            if (moreMenuBtn) {
                streakBadgeOriginalParent.insertBefore(streakBadge, moreMenuBtn);
            } else {
                streakBadgeOriginalParent.appendChild(streakBadge);
            }
        }
    }
}

function updateStreakStateFromServer(data) {
    const count = data && typeof data.streakCount === 'number' ? data.streakCount : 0;
    const broken = !!(data && data.streakBroken);
    const totalDays = data && typeof data.totalLoggedDays === 'number' ? data.totalLoggedDays : 0;
    const longestStreak = data && typeof data.longestStreak === 'number' ? data.longestStreak : 0;
    const rawLogged = Array.isArray(data && data.loggedDates) ? data.loggedDates.slice() : [];
    const loggedDates = rawLogged.map((d) => (typeof d === 'string' ? d : d.date));
    streakState.loggedDatesWithSource = rawLogged;

    streakState.count = count;
    streakState.broken = broken;
    streakState.totalDays = totalDays;
    streakState.longestStreak = longestStreak;
    streakState.loggedDates = loggedDates;
    updateStreakBadge();

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
        iconHtml = '<svg class="icon-fire" aria-hidden="true"><use href="#icon-fire"></use></svg>';
    } else {
        iconHtml = '✨';
    }
    const iconSpan = elements.streakBadge.querySelector('.streak-badge__icon');
    if (iconSpan) iconSpan.innerHTML = iconHtml;
    elements.streakBadge.querySelector('.streak-badge__count').textContent = String(count);
}

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

function openStreakModalForPositive() {
    const count = streakState.count || 0;
    let title = '怎麼這麼乖呀！';
    let text = `今天是記帳的第 ${count} 天，明天也要繼續保持呦☺️`;
    if (STREAK_MILESTONES.includes(count)) {
        title = '里程碑達成！';
        text = `你已經連續記帳 ${count} 天了！真棒真棒🥹`;
    }
    renderStreakCalendar();
    openReactionModal({
        title,
        text,
        buttonLabel: '太讚了，繼續！',
        variant: 'positive'
    });
}

function openStreakModalForBroken() {
    renderStreakCalendar();
    openReactionModal({
        title: '小壞蛋 你偷懶被抓到了！！！',
        text: '吼呦！你昨天迷有記帳 氣鼠了！😡',
        buttonLabel: '我現在補記！',
        variant: 'broken'
    });
}

function openStreakModalForCurrent() {
    const count = streakState.count || 0;
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
            text: `太厲害了！已經連續記錄 ${count} 天，繼續往下一個里程碑前進吧！🔥`,
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

async function submitDailyCheckin() {
    const btn = elements.checkinBtn;
    if (!btn) return;
    const originalText = btn.innerText;
    try {
        btn.disabled = true;
        btn.innerText = '簽到中...';

        const today = getTodayYmd();
        const supabase = getSupabase();
        if (!supabase) throw new Error('Supabase 尚未初始化');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('請先登入');

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

        const v = elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [currentYear, currentMonth];
        await fetchDashboardData(parseInt(v[0], 10), parseInt(v[1], 10));
        alert('今日簽到成功！');
        btn.innerText = originalText;
    } catch (err) {
        reportError(err, '簽到失敗，請稍後再試。');
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

function renderStreakCalendar() {
    if (!elements.streakCalendarRoot) return;

    ensureStreakCalendarMonth();

    const y = streakCalendarYear;
    const m = streakCalendarMonth;

    const loggedBySource = { onTimeTransaction: new Set(), manual: new Set() };
    (streakState.loggedDatesWithSource || streakState.loggedDates || []).forEach((item) => {
        const dateStr = typeof item === 'string' ? item : (item && item.date);
        if (!dateStr) return;
        const source = typeof item === 'object' && item && 'source' in item ? item.source : null;
        const src = source != null ? String(source) : '';
        if (src === 'onTimeTransaction') loggedBySource.onTimeTransaction.add(dateStr);
        else loggedBySource.manual.add(dateStr);
    });

    const firstDay = new Date(y, m - 1, 1);
    const firstWeekday = firstDay.getDay();
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
    weekLabels.forEach((w) => { html += `<div class="streak-calendar__weekday">${w}</div>`; });
    html += '  </div>';
    html += '  <div class="streak-calendar__grid">';

    for (let i = 0; i < firstWeekday; i++) {
        html += '<div class="streak-calendar__day streak-calendar__day--empty"><div class="streak-calendar__day-inner"></div></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        const dateStr = `${y}-${mm}-${dd}`;
        const isTransaction = loggedBySource.onTimeTransaction.has(dateStr);
        const isManual = loggedBySource.manual.has(dateStr);
        const isToday = dateStr === todayStr;
        const isFuture = dateStr > todayStr;

        let cls = 'streak-calendar__day';
        if (!isFuture) {
            if (isTransaction) cls += ' streak-calendar__day--transaction';
            else if (isManual) cls += ' streak-calendar__day--manual';
        }
        if (isToday) cls += ' streak-calendar__day--today';

        html += `<div class="${cls}"><div class="streak-calendar__day-inner">${d}</div></div>`;
    }

    html += '  </div>';
    html += '  <div class="streak-calendar__legend">';
    html += '    <span class="streak-calendar__legend-item streak-calendar__legend-item--transaction">記帳</span>';
    html += '    <span class="streak-calendar__legend-item streak-calendar__legend-item--manual">簽到</span>';
    html += '  </div>';
    html += '</div>';

    const current = streakState.count || 0;
    const total = streakState.totalDays || 0;
    const longest = streakState.longestStreak || 0;
    const streakIconHtml = current > 0 ? '<svg class="icon-fire" aria-hidden="true"><use href="#icon-fire"></use></svg>' : '';
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
    html += '</div>';

    elements.streakCalendarRoot.innerHTML = html;

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

function ensureStreakCalendarMonth() {
    if (streakCalendarYear != null && streakCalendarMonth != null) return;
    const now = new Date();
    streakCalendarYear = now.getFullYear();
    streakCalendarMonth = now.getMonth() + 1;
}

function openReactionModal(opts) {
    if (!elements.reactionModal) return;
    const now = new Date();
    streakCalendarYear = now.getFullYear();
    streakCalendarMonth = now.getMonth() + 1;
    renderStreakCalendar();
    if (elements.reactionTitle) elements.reactionTitle.textContent = (opts && opts.title) ? opts.title : '提醒';
    if (elements.reactionText) elements.reactionText.textContent = '';
    if (elements.reactionModal) {
        elements.reactionModal.classList.add('is-open');
        elements.reactionModal.setAttribute('aria-hidden', 'false');
        elements.reactionModal.setAttribute('data-variant', (opts && opts.variant) ? opts.variant : 'default');
    }
    document.body.classList.add('modal-open');
}

function closeReactionModal() {
    if (!elements.reactionModal) return;
    moveFocusOutBeforeHide(elements.reactionModal);
    elements.reactionModal.classList.remove('is-open');
    elements.reactionModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}
