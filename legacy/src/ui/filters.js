/**
 * Smart Expense Tracker - 表頭篩選與交易表格渲染
 */

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
        const list = transactionHistoryFull || [];
        if (selectedFilterCategories.length === 0) {
            selectedFilterCategories = [...new Set(list.map(t => (t.category && String(t.category).trim()) || '未分類').filter(Boolean))];
        }
        if (selectedFilterPaymentMethods.length === 0) {
            selectedFilterPaymentMethods = [...new Set(list.map(t => (t.paymentMethod && String(t.paymentMethod).trim()) || '其他').filter(Boolean))];
        }
        filterPopoverAnchor = null;
    }
    if (filterPopoverScrollHandler) {
        window.removeEventListener('scroll', filterPopoverScrollHandler, true);
        filterPopoverScrollHandler = null;
    }
}

function repositionFilterPopover(btn) {
    if (!filterPopover || !filterPopover.classList.contains('is-open') || !btn) return;
    const rect = btn.getBoundingClientRect();
    const gutter = 8;
    filterPopover.style.left = rect.left + 'px';
    filterPopover.style.top = (rect.bottom + 4) + 'px';
    const popoverRect = filterPopover.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    if (popoverRect.bottom > vh - gutter) {
        const spaceAbove = rect.top;
        if (spaceAbove >= popoverRect.height + gutter) {
            filterPopover.style.top = (rect.top - popoverRect.height - 4) + 'px';
        } else {
            filterPopover.style.top = Math.max(gutter, vh - popoverRect.height - gutter) + 'px';
        }
    }
    const afterTop = filterPopover.getBoundingClientRect();
    if (afterTop.right > vw - gutter) {
        filterPopover.style.left = (vw - popoverRect.width - gutter) + 'px';
    }
    if (parseInt(filterPopover.style.left, 10) < gutter) {
        filterPopover.style.left = gutter + 'px';
    }
}

function openFilterPopover(btn) {
    if (filterPopoverAnchor === btn) {
        closeFilterPopover();
        return;
    }
    const kind = btn.getAttribute('data-filter');
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
            applyTableFilter(true);
        });
        btnClear.addEventListener('click', () => {
            selectedFilterCategories = [];
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
            applyTableFilter(true);
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
                applyTableFilter(true);
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
            applyTableFilter(true);
        });
        btnClear.addEventListener('click', () => {
            selectedFilterPaymentMethods = [];
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
            applyTableFilter(true);
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
                applyTableFilter(true);
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(pm));
            listEl.appendChild(label);
        });
    }

    popover.classList.add('is-open');
    filterPopoverAnchor = btn;
    repositionFilterPopover(btn);

    if (filterPopoverScrollHandler) {
        window.removeEventListener('scroll', filterPopoverScrollHandler, true);
    }
    filterPopoverScrollHandler = debounce(() => {
        if (Date.now() < filterPopoverIgnoreScrollUntil) return;
        closeFilterPopover();
    }, DEBOUNCE.SCROLL_MS);
    window.addEventListener('scroll', filterPopoverScrollHandler, true);
}

function applyTableFilter(shouldScroll) {
    if (shouldScroll) filterPopoverIgnoreScrollUntil = Date.now() + TIMING.FILTER_IGNORE_SCROLL_MS;
    const list = transactionHistoryFull || [];
    const filtered = list.filter(tx => {
        const cat = (tx.category && String(tx.category).trim()) || '未分類';
        const pm = (tx.paymentMethod && String(tx.paymentMethod).trim()) || '其他';
        return (selectedFilterCategories.length === 0 || selectedFilterCategories.includes(cat)) &&
               (selectedFilterPaymentMethods.length === 0 || selectedFilterPaymentMethods.includes(pm));
    });
    currentTransactions = filtered;
    renderTable(filtered);
    if (shouldScroll) {
        if (filterPopoverAnchor) {
            const anchor = filterPopoverAnchor;
            let rafId = null;
            const onScroll = () => {
                if (rafId) return;
                rafId = requestAnimationFrame(() => {
                    repositionFilterPopover(anchor);
                    rafId = null;
                });
            };
            const onScrollEnd = () => {
                window.removeEventListener('scroll', onScroll, true);
                if (rafId) cancelAnimationFrame(rafId);
                repositionFilterPopover(anchor);
            };
            window.addEventListener('scroll', onScroll, true);
            if ('onscrollend' in window) {
                window.addEventListener('scrollend', onScrollEnd, { once: true });
            } else {
                setTimeout(onScrollEnd, TIMING.FILTER_REPOSITION_AFTER_SCROLL_MS);
            }
        }
        scrollToTransactionHistory();
    }
}

function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    const isMobile = window.innerWidth <= LAYOUT.MOBILE_MAX_WIDTH;
    if (!isMobile) return dateStr;

    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const month = parts[1];
        const day = parts[2];
        return `${month}-${day}`;
    }
    return dateStr;
}

function renderTable(history) {
    if (!elements.transactionList) return;
    currentTransactions = history || [];
    elements.transactionList.innerHTML = '';

    currentTransactions.forEach(tx => {
        const row = document.createElement('tr');
        row.className = 'transaction-row';
        row.setAttribute('data-id', escapeHtml(String(tx.id || '')));

        const contentCell = document.createElement('td');
        contentCell.className = 'transaction-row-cell';
        contentCell.colSpan = 6;

        const swipeContainer = document.createElement('div');
        swipeContainer.className = 'swipe-container';

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

        const swipeEditAction = document.createElement('div');
        swipeEditAction.className = 'swipe-action swipe-action--edit';
        swipeEditAction.innerHTML = `
            <button type="button" class="swipe-action-btn swipe-action-btn--edit" data-id="${escapeHtml(String(tx.id || ''))}" aria-label="編輯">
                <svg class="icon-edit" aria-hidden="true"><use href="#icon-edit"></use></svg>
            </button>
        `;

        const swipeDeleteAction = document.createElement('div');
        swipeDeleteAction.className = 'swipe-action swipe-action--delete';
        swipeDeleteAction.innerHTML = `
            <button type="button" class="swipe-action-btn swipe-action-btn--delete" data-id="${escapeHtml(String(tx.id || ''))}" aria-label="刪除">
                <svg class="icon-delete" aria-hidden="true"><use href="#icon-delete"></use></svg>
            </button>
        `;

        swipeContainer.appendChild(swipeEditAction);
        swipeContainer.appendChild(content);
        swipeContainer.appendChild(swipeDeleteAction);
        contentCell.appendChild(swipeContainer);
        row.appendChild(contentCell);

        const editBtn = content.querySelector('.btn-edit');
        const delBtn = content.querySelector('.btn-delete');
        if (editBtn) editBtn.addEventListener('click', function () { startEdit(this.getAttribute('data-id')); });
        if (delBtn) delBtn.addEventListener('click', function () { deleteTransaction(this.getAttribute('data-id')); });

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

        initSwipe(swipeContainer);

        content.addEventListener('click', (e) => {
            if (e.target.closest('.btn-edit, .btn-delete')) return;
            if (swipeContainer.classList.contains('swiped-left') || swipeContainer.classList.contains('swiped-right')) return;
            showTransactionDetail(tx);
        });

        elements.transactionList.appendChild(row);
    });
}
