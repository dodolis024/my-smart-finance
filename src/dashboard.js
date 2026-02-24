/**
 * Smart Expense Tracker - 儀表板資料與渲染
 */

async function fetchDashboardData(year, month) {
    try {
        setLoading(true);
        console.log(`Fetching data for ${year}-${month}...`);

        const supabase = getSupabase();
        if (!supabase) throw new Error('Supabase 尚未初始化');

        const { data, error } = await supabase.rpc('get_dashboard_data', {
            p_client_today: getTodayYmd(),
            p_month: parseInt(month, 10),
            p_year: parseInt(year, 10)
        });

        if (error) throw new Error(error.message || '無法取得資料');
        if (!data || !data.success) throw new Error(data?.error || '無法取得資料');

        updateStats(data.summary);

        updateStreakStateFromServer(data);
        if (!streakInitialHandled) {
            streakInitialHandled = true;
            maybeShowBrokenModalOnLoad();
        }

        transactionHistoryFull = data.history || [];
        applyTableFilter();

        renderChart(data.history, data.categoriesIncome);

        currentAccounts = data.accounts || [];
        renderPaymentStats(data.history);

        populateCategories(data);

        populatePaymentMethods(data.accounts);

        return data;
    } catch (error) {
        reportError(error, '無法讀取資料，請檢查網路或 API 網址。');
        return null;
    } finally {
        setLoading(false);
        syncDashboardHeightToForm();
    }
}

function updateStats(summary) {
    if (elements.totalIncome) elements.totalIncome.innerText = formatMoney(Math.round(summary.totalIncome));
    if (elements.totalExpense) elements.totalExpense.innerText = formatMoney(Math.round(summary.totalExpense));
    if (elements.balance) elements.balance.innerText = formatMoney(Math.round(summary.balance));

    if (elements.balance) {
        elements.balance.classList.remove('balance-positive', 'balance-negative');
        elements.balance.classList.add(summary.balance >= 0 ? 'balance-positive' : 'balance-negative');
    }
}

function renderChart(history, incomeCategories) {
    const canvas = elements.categoryChart;
    const statsEl = elements.categoryStats;
    if (!canvas) return;

    const byCat = {};
    const incomeSet = new Set(incomeCategories || []);
    (history || []).forEach((tx) => {
        const rawCat = tx.category && String(tx.category).trim() ? tx.category : '未分類';
        if (incomeSet.has(rawCat)) return;
        const cat = rawCat;
        const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
        byCat[cat] = (byCat[cat] || 0) + amt;
    });

    const labels = Object.keys(byCat);
    const pairs = labels.map((l) => ({ label: l, value: byCat[l] })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    if (expenseChart) {
        expenseChart.destroy();
        expenseChart = null;
    }

    var legendEl = document.getElementById('categoryChartLegend');
    if (legendEl) legendEl.innerHTML = '';

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
            layout: { padding: 8 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: function () { return ''; },
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
            pairs.map((p) => {
                const account = currentAccounts.find(a => (a.name || a.accountName) === p.label);
                const isCreditCard = account && account.type === 'credit_card';
                const clickableClass = isCreditCard ? ' clickable' : '';
                const dataAttr = account ? ` data-account-id="${escapeHtml(String(account.id))}"` : '';
                return `<li class="${clickableClass.trim()}"${dataAttr}><span class="pay-name">${escapeHtml(p.label)}</span><span class="pay-amount">${formatMoney(p.value)}</span></li>`;
            }).join('') +
            '</ul>';

        const clickableItems = el.querySelectorAll('.payment-stats-list li.clickable');
        clickableItems.forEach((item) => {
            item.addEventListener('click', function() {
                const accountId = this.getAttribute('data-account-id');
                if (accountId) openCreditCardModal(accountId);
            });
        });
    }
}

function calculateCreditUsage(accountId, accountName, billingDay, paymentDueDay) {
    if (!billingDay) return 0;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    let lastBillingYear = currentYear;
    let lastBillingMonth = currentMonth;

    if (currentDay < billingDay) {
        lastBillingMonth -= 1;
        if (lastBillingMonth < 1) {
            lastBillingMonth = 12;
            lastBillingYear -= 1;
        }
    }

    let prevBillingYear = lastBillingYear;
    let prevBillingMonth = lastBillingMonth - 1;
    if (prevBillingMonth < 1) {
        prevBillingMonth = 12;
        prevBillingYear -= 1;
    }

    const formatDate = (y, m, d) => {
        const month = String(m).padStart(2, '0');
        const day = String(d).padStart(2, '0');
        return `${y}-${month}-${day}`;
    };

    const prevBillingDate = formatDate(prevBillingYear, prevBillingMonth, billingDay);
    const lastBillingDate = formatDate(lastBillingYear, lastBillingMonth, billingDay);
    let lastBillingEndDay = billingDay - 1;
    let lastBillingEndMonth = lastBillingMonth;
    let lastBillingEndYear = lastBillingYear;
    if (lastBillingEndDay < 1) {
        lastBillingEndMonth -= 1;
        if (lastBillingEndMonth < 1) {
            lastBillingEndMonth = 12;
            lastBillingEndYear -= 1;
        }
        lastBillingEndDay = new Date(lastBillingEndYear, lastBillingEndMonth, 0).getDate();
    }
    const lastBillingEndDate = formatDate(lastBillingEndYear, lastBillingEndMonth, lastBillingEndDay);

    let hasPaid = false;
    if (paymentDueDay) {
        if (paymentDueDay > billingDay) {
            if (currentDay >= billingDay && currentDay >= paymentDueDay) hasPaid = true;
        } else {
            if (currentDay < billingDay && currentDay >= paymentDueDay) hasPaid = true;
        }
    }

    let totalUsed = 0;
    (transactionHistoryFull || []).forEach((tx) => {
        if (tx.type !== 'expense') return;
        const matchAccount = tx.account_id === accountId || tx.paymentMethod === accountName;
        if (!matchAccount) return;

        const txDate = tx.date;
        const amt = typeof tx.twdAmount === 'number' ? Math.abs(tx.twdAmount) : 0;

        if (!hasPaid) {
            if (txDate >= prevBillingDate && txDate <= lastBillingEndDate) totalUsed += amt;
        }

        const todayDate = formatDate(currentYear, currentMonth, currentDay);
        if (txDate >= lastBillingDate && txDate <= todayDate) totalUsed += amt;
    });

    return totalUsed;
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
        reportError(e, '無法載入幣別選單，將使用 TWD。');
        sel.innerHTML = '<option value="TWD" selected>TWD</option>';
    }
}

function syncDashboardHeightToForm() {
    const dashboardColumn = elements.dashboardColumn;
    if (dashboardColumn && window.innerWidth <= LAYOUT.VERTICAL_MAX_WIDTH) {
        dashboardColumn.style.maxHeight = '';
    }
}

function setLoading(isLoading) {
    document.body.style.cursor = isLoading ? 'wait' : 'default';
    if (elements.monthSelect) elements.monthSelect.disabled = !!isLoading;
    const trigger = document.getElementById('monthPickerTrigger');
    if (trigger) trigger.disabled = !!isLoading;
}

// Month Picker
const monthPickerTrigger = document.getElementById('monthPickerTrigger');
const monthPickerPopover = document.getElementById('monthPickerPopover');
const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let monthPickerDisplayYear = currentYear;

function formatMonthLabel(year, month) {
    return MONTH_ABBREVS[month - 1] + ' ' + year;
}

function ensureMonthOption(year, month) {
    const value = `${year}-${month}`;
    if (!elements.monthSelect) return;
    const sel = elements.monthSelect;
    if (!Array.from(sel.options).some(o => o.value === value)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = formatMonthLabel(year, month);
        sel.appendChild(opt);
    }
    sel.value = value;
}

function updateMonthPickerTriggerLabel() {
    const triggerLabel = document.querySelector('.month-picker-trigger__label');
    if (!triggerLabel || !elements.monthSelect) return;
    const sel = elements.monthSelect;
    const v = sel.value ? sel.value.split('-') : [currentYear, currentMonth];
    const y = parseInt(v[0], 10);
    const m = parseInt(v[1], 10);
    triggerLabel.textContent = formatMonthLabel(y, m);
}

function renderMonthPickerPopover() {
    if (!monthPickerPopover || !elements.monthSelect) return;
    monthPickerPopover.innerHTML = '';
    const yearRow = document.createElement('div');
    yearRow.className = 'month-picker-year-row';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'month-picker-year-btn';
    prevBtn.setAttribute('aria-label', '上一年');
    prevBtn.setAttribute('data-dir', '-1');
    prevBtn.innerHTML = '&larr;';
    const yearDisplay = document.createElement('span');
    yearDisplay.className = 'month-picker-year-display';
    yearDisplay.textContent = monthPickerDisplayYear;
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'month-picker-year-btn';
    nextBtn.setAttribute('aria-label', '下一年');
    nextBtn.setAttribute('data-dir', '1');
    nextBtn.innerHTML = '&rarr;';
    yearRow.appendChild(prevBtn);
    yearRow.appendChild(yearDisplay);
    yearRow.appendChild(nextBtn);
    monthPickerPopover.appendChild(yearRow);
    const grid = document.createElement('div');
    grid.className = 'month-picker-grid';
    for (let m = 1; m <= 12; m++) {
        const value = `${monthPickerDisplayYear}-${m}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'month-picker-item';
        btn.setAttribute('role', 'option');
        btn.setAttribute('data-value', value);
        btn.textContent = MONTH_ABBREVS[m - 1];
        const selVal = elements.monthSelect.value || `${currentYear}-${currentMonth}`;
        if (value === selVal) btn.classList.add('is-selected');
        btn.addEventListener('click', () => {
            ensureMonthOption(monthPickerDisplayYear, m);
            elements.monthSelect.dispatchEvent(new Event('change'));
            closeMonthPickerPopover();
            updateMonthPickerTriggerLabel();
        });
        grid.appendChild(btn);
    }
    monthPickerPopover.appendChild(grid);
}

function openMonthPickerPopover() {
    if (!monthPickerPopover || !monthPickerTrigger) return;
    document.body.appendChild(monthPickerPopover);
    const v = elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [String(currentYear), String(currentMonth)];
    monthPickerDisplayYear = parseInt(v[0], 10);
    renderMonthPickerPopover();
    monthPickerPopover.classList.add('is-open');
    monthPickerTrigger.setAttribute('aria-expanded', 'true');
    monthPickerPopover.setAttribute('aria-hidden', 'false');
    const rect = monthPickerTrigger.getBoundingClientRect();
    const gap = 6;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const popoverHeight = 220;
    if (spaceAbove >= popoverHeight + gap && spaceAbove >= spaceBelow) {
        monthPickerPopover.style.top = '';
        monthPickerPopover.style.bottom = (window.innerHeight - rect.top + gap) + 'px';
    } else {
        monthPickerPopover.style.bottom = '';
        monthPickerPopover.style.top = (rect.bottom + gap) + 'px';
    }
    monthPickerPopover.style.left = rect.left + 'px';
    requestAnimationFrame(() => {
        const width = monthPickerPopover.offsetWidth;
        const maxLeft = window.innerWidth - width - 16;
        const minLeft = 16;
        let left = parseFloat(monthPickerPopover.style.left) || rect.left;
        if (left > maxLeft) left = maxLeft;
        if (left < minLeft) left = minLeft;
        monthPickerPopover.style.left = left + 'px';
    });
}

function closeMonthPickerPopover() {
    if (!monthPickerPopover || !monthPickerTrigger) return;
    monthPickerPopover.classList.remove('is-open');
    monthPickerTrigger.setAttribute('aria-expanded', 'false');
    monthPickerPopover.setAttribute('aria-hidden', 'true');
    monthPickerPopover.style.top = '';
    monthPickerPopover.style.bottom = '';
    const parent = document.getElementById('monthPicker');
    if (parent) parent.appendChild(monthPickerPopover);
}

function initMonthSelector() {
    if (!elements.monthSelect) return;
    elements.monthSelect.innerHTML = '';
    ensureMonthOption(currentYear, currentMonth);
    updateMonthPickerTriggerLabel();
    if (monthPickerTrigger) {
        monthPickerTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (monthPickerPopover.classList.contains('is-open')) {
                closeMonthPickerPopover();
            } else {
                openMonthPickerPopover();
            }
        });
    }
    document.addEventListener('click', (e) => {
        if (monthPickerPopover && monthPickerPopover.classList.contains('is-open') &&
            !monthPickerPopover.contains(e.target) && !monthPickerTrigger.contains(e.target)) {
            closeMonthPickerPopover();
        }
    });
    if (monthPickerPopover) {
        monthPickerPopover.addEventListener('click', (e) => {
            const btn = e.target.closest('.month-picker-year-btn');
            if (!btn) return;
            e.stopPropagation();
            const dir = parseInt(btn.getAttribute('data-dir'), 10);
            monthPickerDisplayYear += dir;
            renderMonthPickerPopover();
        });
    }
}
