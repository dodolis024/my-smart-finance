/**
 * Smart Expense Tracker - 交易 CRUD
 */

async function submitTransaction() {
    if (!elements.itemInput.value || !elements.amountInput.value) {
        alert('請填寫項目名稱與金額！');
        return;
    }
    if (!elements.methodInput.value) {
        alert('請選擇支付方式！');
        return;
    }

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
        const categoryValue = elements.categorySelect.value;
        const paymentMethod = elements.methodInput.value;
        const currency = elements.currencyInput.value || 'TWD';
        const amountValue = parseFormattedNumber(elements.amountInput.value);
        const amount = parseFloat(amountValue);
        if (isNaN(amount) || amount <= 0) {
            alert('請輸入有效的金額！');
            btn.disabled = false;
            btn.innerText = originalText;
            return;
        }
        const note = elements.noteInput.value || null;

        let type, category;
        if (categoryValue.startsWith('expense:')) {
            type = 'expense';
            category = categoryValue.slice(8);
        } else if (categoryValue.startsWith('income:')) {
            type = 'income';
            category = categoryValue.slice(7);
        } else {
            const { data: incomeCategories } = await supabase
                .from('settings')
                .select('value')
                .eq('key', 'income_categories')
                .single();
            const incomeCats = incomeCategories?.value || ['薪水', '投資'];
            const isIncome = Array.isArray(incomeCats) && incomeCats.includes(categoryValue);
            type = isIncome ? 'income' : 'expense';
            category = categoryValue;
        }

        const { data: exchangeRateVal, error: rateErr } = await supabase
            .rpc('get_exchange_rate', { p_currency: currency.trim().toUpperCase() });

        const exchangeRate = (rateErr == null && exchangeRateVal != null && exchangeRateVal > 0)
            ? Number(exchangeRateVal) : 1.0;
        const twdAmount = Math.round(amount * exchangeRate * 100) / 100;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            alert('請先登入');
            return;
        }

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
            const { error } = await supabase
                .from('transactions')
                .update(transactionData)
                .eq('id', editingId);

            if (error) throw error;

            const submittedDate = date;
            const [y, m] = submittedDate ? submittedDate.split('-') : (elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [String(currentYear), String(currentMonth)]);
            resetEditState(true);
            await fetchDashboardData(parseInt(y, 10), parseInt(m, 10));
            alert('已更新。');
        } else {
            const { error } = await supabase
                .from('transactions')
                .insert(transactionData);

            if (error) throw error;

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

            const submittedDate = date;
            const [y, m] = submittedDate ? submittedDate.split('-') : (elements.monthSelect && elements.monthSelect.value ? elements.monthSelect.value.split('-') : [String(currentYear), String(currentMonth)]);
            resetEditState();
            await fetchDashboardData(parseInt(y, 10), parseInt(m, 10));
            maybeShowPositiveModalAfterAdd(submittedDate);
            alert('記帳成功！');
        }
    } catch (error) {
        reportError(error, '記帳失敗，請稍後再試。');
    } finally {
        const btn = elements.addBtn;
        btn.innerText = editingId ? "更新交易" : "新增交易";
        btn.disabled = false;
    }
}

async function deleteTransaction(id) {
    if (!id) return;
    if (!confirm('確定要刪除這筆交易嗎？')) return;

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
        reportError(error, '刪除失敗，請稍後再試。');
    } finally {
        setLoading(false);
    }
}

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

    if (wasEditing && (scrollToHistory !== false)) {
        scrollToTransactionHistory();
    }
}

function scrollToTransactionHistory() {
    const historySection = document.querySelector('.transaction-history-section');
    if (historySection) {
        setTimeout(() => {
            historySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

function startEdit(id) {
    const tx = currentTransactions.find(function (t) { return t.id === id || String(t.id) === String(id); });
    if (!tx) return;

    if (elements.dateInput) elements.dateInput.value = tx.date || '';
    if (elements.itemInput) elements.itemInput.value = tx.itemName || '';
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
    const txType = String(tx.type || 'expense');
    const prefixedValue = (txType === 'income' ? 'income:' : 'expense:') + cat;
    if (elements.categorySelect) {
        if (!Array.from(elements.categorySelect.options).some(function (o) { return o.value === prefixedValue; })) {
            const opt = document.createElement('option');
            opt.value = prefixedValue;
            opt.textContent = cat;
            elements.categorySelect.appendChild(opt);
        }
        elements.categorySelect.value = prefixedValue;
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

function setupAmountInputFormatting() {
    if (!elements.amountInput) return;

    elements.amountInput.addEventListener('input', (e) => {
        const cursorPosition = e.target.selectionStart;
        const oldValue = e.target.value;
        const formatted = formatNumberWithCommas(oldValue);

        const commasBeforeCursor = (oldValue.substring(0, cursorPosition).match(/,/g) || []).length;
        const newCommasBeforeCursor = (formatted.substring(0, cursorPosition).match(/,/g) || []).length;
        const cursorAdjustment = newCommasBeforeCursor - commasBeforeCursor;
        const newCursorPosition = cursorPosition + cursorAdjustment;

        e.target.value = formatted;

        setTimeout(() => {
            e.target.setSelectionRange(newCursorPosition, newCursorPosition);
        }, 0);
    });

    elements.amountInput.addEventListener('blur', (e) => {
        const value = e.target.value.trim();
        if (value) {
            e.target.value = formatNumberWithCommas(value);
        }
    });

    elements.amountInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        const cleaned = parseFormattedNumber(pastedText);
        if (cleaned) {
            const formatted = formatNumberWithCommas(cleaned);
            e.target.value = formatted;
            setTimeout(() => {
                e.target.setSelectionRange(formatted.length, formatted.length);
            }, 0);
        }
    });
}
