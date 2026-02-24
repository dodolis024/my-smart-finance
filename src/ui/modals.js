/**
 * Smart Expense Tracker - Modal 管理
 */

function showTransactionDetail(tx) {
    if (!tx) return;

    let modal = document.getElementById('transactionDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'transactionDetailModal';
        modal.className = 'transaction-detail-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'transactionDetailTitle');
        modal.setAttribute('aria-hidden', 'true');
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-close="modal"]')) {
                closeTransactionDetail();
            }
        });
    }

    const originalAmount = tx.originalAmount != null ? tx.originalAmount : (tx.amount != null ? tx.amount : tx.twdAmount);
    const currency = tx.currency || 'TWD';
    const exchangeRate = tx.exchangeRate || 1.0;
    const twdAmount = tx.twdAmount || 0;
    const note = tx.note || '無';

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

    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">日期</div>';
    html += `      <div class="transaction-detail-value">${escapeHtml(tx.date)}</div>`;
    html += '    </div>';

    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">分類</div>';
    html += `      <div class="transaction-detail-value"><span class="badge">${escapeHtml(tx.category)}</span></div>`;
    html += '    </div>';

    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">項目</div>';
    html += `      <div class="transaction-detail-value">${escapeHtml(tx.itemName)}</div>`;
    html += '    </div>';

    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">金額</div>';
    html += `      <div class="transaction-detail-value transaction-detail-amount">${formatNumberWithCommas(String(originalAmount))} ${escapeHtml(currency)}</div>`;
    html += '    </div>';

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

    html += '    <div class="transaction-detail-item">';
    html += '      <div class="transaction-detail-label">支付方式</div>';
    html += `      <div class="transaction-detail-value">${escapeHtml(tx.paymentMethod)}</div>`;
    html += '    </div>';

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

    moveFocusOutBeforeHide(modal);
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

function toggleMoreMenu(btn, dropdown) {
    const isOpen = dropdown.classList.contains('is-open');
    closeMoreMenu();
    closeUserAvatarDropdown();
    if (!isOpen) {
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

function closeUserAvatarDropdown() {
    document.querySelectorAll('.user-avatar-dropdown').forEach(d => {
        if (d.classList.contains('is-open')) {
            moveFocusOutBeforeHide(d);
            d.setAttribute('aria-hidden', 'true');
        }
        d.classList.remove('is-open');
    });
    document.querySelectorAll('.user-avatar-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function toggleUserAvatarDropdown(btn, dropdown) {
    closeMoreMenu();
    const isOpen = dropdown.classList.contains('is-open');
    closeUserAvatarDropdown();
    if (!isOpen) {
        dropdown.classList.add('is-open');
        dropdown.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
    }
}

function focusTransactionInput() {
    const form = document.getElementById('transactionForm');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
    if (elements.itemInput) {
        setTimeout(() => elements.itemInput.focus(), TIMING.FOCUS_DELAY);
    }
}

// Credit Card Modal
const creditCardModal = document.getElementById('creditCardModal');
const creditCardCloseBtn = document.getElementById('creditCardCloseBtn');

function getDaysUntilDay(day) {
    if (!day || day < 1 || day > 31) return null;
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    let nextDate = new Date(currentYear, currentMonth, day);
    if (currentDay > day) {
        nextDate.setMonth(currentMonth + 1);
    }
    const diffTime = nextDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

function openCreditCardModal(accountId) {
    if (!creditCardModal) return;

    const account = currentAccounts.find(a => a.id === accountId || String(a.id) === String(accountId));

    if (!account) {
        alert('找不到該帳戶資料');
        return;
    }

    const titleEl = document.getElementById('creditCardTitle');
    const accountName = account.name || account.accountName || '信用卡';
    if (titleEl) titleEl.textContent = `${accountName}`;

    const creditLimit = account.creditLimit || account.credit_limit;
    const billingDay = account.billingDay || account.billing_day;
    const paymentDueDay = account.paymentDueDay || account.payment_due_day;

    if (!creditLimit) {
        document.getElementById('creditAvailable').textContent = '未設定';
        document.getElementById('creditUsedText').textContent = '未設定信用額度';
        document.getElementById('creditTotalText').textContent = '';
        document.getElementById('creditLimitBar').style.width = '0%';
        document.getElementById('creditLimitBar').style.backgroundColor = '#e0e0e0';
        document.getElementById('creditLimitPercent').textContent = '';
        document.getElementById('creditLimitPercent').style.color = '';
    } else {
        const accountNameForCalc = account.name || account.accountName;
        const usedAmount = calculateCreditUsage(account.id, accountNameForCalc, billingDay, paymentDueDay);
        const available = Math.floor(Math.max(0, creditLimit - usedAmount)); // 信用卡無小數
        const usagePercent = creditLimit > 0 ? (usedAmount / creditLimit) * 100 : 0;

        document.getElementById('creditAvailable').textContent = formatMoney(available);
        document.getElementById('creditUsedText').textContent = `已使用：${formatMoney(usedAmount)}`;
        document.getElementById('creditTotalText').textContent = `總額度：${formatMoney(creditLimit)}`;

        const progressBar = document.getElementById('creditLimitBar');
        progressBar.style.width = `${Math.min(100, usagePercent)}%`;

        const percentColor = usagePercent <= 50 ? '#4caf50' : usagePercent <= 80 ? '#ff9800' : '#f44336';
        if (usagePercent <= 50) {
            progressBar.style.backgroundColor = '#4caf50';
        } else if (usagePercent <= 80) {
            progressBar.style.backgroundColor = '#ff9800';
        } else {
            progressBar.style.backgroundColor = '#f44336';
        }
        const percentEl = document.getElementById('creditLimitPercent');
        percentEl.textContent = usagePercent % 1 === 0 ? `${Math.round(usagePercent)}%` : `${usagePercent.toFixed(1)}%`;
        percentEl.style.color = percentColor;
    }

    document.getElementById('creditBillingDay').textContent = billingDay ? `每月 ${billingDay} 日` : '未設定';
    document.getElementById('creditPaymentDay').textContent = paymentDueDay ? `每月 ${paymentDueDay} 日` : '未設定';

    const billingCountdownEl = document.getElementById('creditBillingCountdown');
    if (billingDay) {
        const billingDays = getDaysUntilDay(billingDay);
        const isBillingUrgent = billingDays !== null && billingDays <= 5;
        billingCountdownEl.innerHTML = billingDays !== null
            ? `還有 <span class="credit-countdown-num${isBillingUrgent ? ' credit-countdown-urgent' : ''}">${billingDays}</span> 天`
            : '';
    } else {
        billingCountdownEl.textContent = '';
    }

    const paymentCountdownEl = document.getElementById('creditPaymentCountdown');
    if (paymentDueDay) {
        const paymentDays = getDaysUntilDay(paymentDueDay);
        const isPaymentUrgent = paymentDays !== null && paymentDays <= 5;
        paymentCountdownEl.innerHTML = paymentDays !== null
            ? `還有 <span class="credit-countdown-num${isPaymentUrgent ? ' credit-countdown-urgent' : ''}">${paymentDays}</span> 天`
            : '';
    } else {
        paymentCountdownEl.textContent = '';
    }

    creditCardModal.classList.add('is-open');
    creditCardModal.setAttribute('aria-hidden', 'false');
}

function closeCreditCardModal() {
    if (!creditCardModal) return;
    moveFocusOutBeforeHide(creditCardModal);
    creditCardModal.classList.remove('is-open');
    creditCardModal.setAttribute('aria-hidden', 'true');
}

if (creditCardCloseBtn) {
    creditCardCloseBtn.addEventListener('click', closeCreditCardModal);
}

if (creditCardModal) {
    creditCardModal.querySelector('.credit-card-modal__backdrop')?.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-close')) {
            closeCreditCardModal();
        }
    });
}

// Changelog Modal
const changelogModal = document.getElementById('changelogModal');
const changelogContent = document.getElementById('changelogContent');
const changelogBtn = document.getElementById('changelogBtn');
const changelogBtnMobile = document.getElementById('changelogBtnMobile');
const changelogCloseBtn = document.getElementById('changelogCloseBtn');

function parseChangelogMarkdown(text) {
    const entries = [];
    const sectionRegex = /^## \[([^\]]+)\]\s*-\s*([^\n]*)\s*$/gm;
    const sections = [];
    let m;
    while ((m = sectionRegex.exec(text)) !== null) {
        sections.push({
            version: m[1],
            date: m[2],
            headerEnd: m.index + m[0].length,
            nextHeaderStart: m.index
        });
    }
    for (let i = 0; i < sections.length; i++) {
        const { version, date, headerEnd } = sections[i];
        const contentEnd = i + 1 < sections.length ? sections[i + 1].nextHeaderStart : text.length;
        const block = text.slice(headerEnd, contentEnd).trim();
        const changes = block.split('\n')
            .map(line => line.replace(/^\s*[-*]\s+/, '').trim())
            .filter(line => line.length > 0);
        entries.push({ version, date, changes });
    }
    return entries;
}

function renderChangelog(entries) {
    if (!changelogContent) return;
    if (!entries || entries.length === 0) {
        changelogContent.innerHTML = '<p class="changelog-empty">暫無更新紀錄，或無法載入 CHANGELOG.md。請確保透過 HTTP 伺服器執行（例如 <code>npx serve .</code>）。</p>';
        return;
    }
    changelogContent.innerHTML = entries.map(({ version, date, changes }) => `
        <div class="changelog-entry">
            <div class="changelog-entry__header">
                <span class="changelog-entry__version">v${escapeHtml(version)}</span>
                <span class="changelog-entry__date">${escapeHtml(date)}</span>
            </div>
            <ul class="changelog-entry__list">
                ${changes.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
            </ul>
        </div>
    `).join('');
}

const CHANGELOG_FALLBACK = [
    { version: '1.1.0', date: 'Feb-23 2026', changes: ['新增更新日記（Change Log）功能，可於更多選項中查看版本紀錄'] },
    { version: '1.0.0', date: 'Jan-15 2026', changes: ['初版上線', '交易記帳、類別與帳戶管理', '今日簽到、記帳日曆', '圖表分析、多幣別支援', '交易篩選、手機版優化'] }
];

async function loadAndRenderChangelog() {
    if (!changelogContent) return;
    try {
        const url = new URL('CHANGELOG.md', window.location.href).href;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch');
        const text = await res.text();
        const entries = parseChangelogMarkdown(text);
        renderChangelog(entries.length > 0 ? entries : CHANGELOG_FALLBACK);
    } catch (err) {
        console.warn('無法載入 CHANGELOG.md，使用備援內容:', err);
        renderChangelog(CHANGELOG_FALLBACK);
    }
}

function openChangelogModal() {
    if (!changelogModal) return;
    loadAndRenderChangelog();
    changelogModal.classList.add('is-open');
    changelogModal.setAttribute('aria-hidden', 'false');
}

function closeChangelogModal() {
    if (!changelogModal) return;
    moveFocusOutBeforeHide(changelogModal);
    changelogModal.classList.remove('is-open');
    changelogModal.setAttribute('aria-hidden', 'true');
}

function openChangelogModalAndCloseMenu() {
    closeMoreMenu();
    closeUserAvatarDropdown();
    openChangelogModal();
}
