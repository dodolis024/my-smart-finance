/**
 * Smart Expense Tracker - Frontend Logic
 */

// ⚠️ PASTE YOUR GOOGLE APPS SCRIPT URL HERE
const API_URL = "https://script.google.com/macros/s/AKfycbz2M17edMc6xd1Y_61PQHkLXYNYydtxVFzUBSCM81ezOmpALwJ8nhDfl3qSb87EjsK5tA/exec";
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
    noteInput: document.getElementById('note')
};

// Chart.js instance for category doughnut (destroy before re-create when switching months)
let expenseChart = null;

// State: 目前畫面上的交易列表；編輯模式時為該筆 id
let currentTransactions = [];
let editingId = null;

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

        // F. Update Payment Methods from Accounts (每次更新，與 Accounts 分頁同步)
        populatePaymentMethods(data.accounts);

    } catch (error) {
        console.error('Error fetching data:', error);
        alert('無法讀取資料，請檢查網路或 API 網址。');
    } finally {
        setLoading(false);
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