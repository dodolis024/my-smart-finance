/**
 * Smart Expense Tracker - 設定管理 (類別與帳戶)
 */

let currentExpenseCategories = [];
let currentIncomeCategories = [];

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

function openSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add('is-open');
    settingsModal.setAttribute('aria-hidden', 'false');
    loadSettingsData();
}

function closeSettingsModal() {
    if (!settingsModal) return;
    moveFocusOutBeforeHide(settingsModal);
    settingsModal.classList.remove('is-open');
    settingsModal.setAttribute('aria-hidden', 'true');
    fetchDashboardData(currentYear, currentMonth);
}

async function loadSettingsData() {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

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

        const { data: accounts } = await supabase
            .from('accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });

        currentAccounts = accounts || [];
        renderAccounts();
    } catch (error) {
        reportError(error, '載入設定資料失敗，請稍後再試。');
    }
}

function renderCategories() {
    if (!expenseCategoryList || !incomeCategoryList) return;

    expenseCategoryList.innerHTML = currentExpenseCategories.map((cat, index) => `
        <li class="category-item">
            <span class="category-item__name">${escapeHtml(cat)}</span>
            <div class="category-item__actions">
                <button type="button" class="category-item__btn" data-action="rename-category" data-type="expense" data-index="${index}">重新命名</button>
                <button type="button" class="category-item__btn category-item__btn--delete" data-action="delete-category" data-type="expense" data-index="${index}">刪除</button>
            </div>
        </li>
    `).join('');

    incomeCategoryList.innerHTML = currentIncomeCategories.map((cat, index) => `
        <li class="category-item">
            <span class="category-item__name">${escapeHtml(cat)}</span>
            <div class="category-item__actions">
                <button type="button" class="category-item__btn" data-action="rename-category" data-type="income" data-index="${index}">重新命名</button>
                <button type="button" class="category-item__btn category-item__btn--delete" data-action="delete-category" data-type="income" data-index="${index}">刪除</button>
            </div>
        </li>
    `).join('');
}

async function addCategory(type) {
    try {
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
    } catch (err) {
        reportError(err, '新增類別失敗，請稍後再試。');
    }
}

async function renameCategoryPrompt(type, index) {
    try {
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

        await updateTransactionCategories(oldName, trimmedName);
    } catch (err) {
        reportError(err, '重新命名類別失敗，請稍後再試。');
    }
}

async function deleteCategory(type, index) {
    try {
        const categories = type === 'expense' ? currentExpenseCategories : currentIncomeCategories;
        const categoryName = categories[index];

        if (!confirm(`確定要刪除類別「${categoryName}」嗎？\n\n注意：既有交易的類別名稱會保留。`)) return;

        categories.splice(index, 1);
        await saveCategoriesType(type);
    } catch (err) {
        reportError(err, '刪除類別失敗，請稍後再試。');
    }
}

async function saveCategoriesType(type) {
    const supabase = getSupabase();
    if (!supabase) {
        reportError(new Error('Supabase 尚未初始化'), 'Supabase 尚未初始化，請重新整理頁面。');
        return;
    }

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
            }, {
                onConflict: 'user_id,key'
            });

        if (error) throw error;

        renderCategories();
    } catch (error) {
        reportError(error, '儲存類別失敗，請稍後再試。');
    }
}

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
        reportError(error, '更新交易類別失敗，請稍後再試。');
    }
}

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
                        <button type="button" class="account-item__btn" data-action="edit-account" data-account-id="${account.id}">編輯</button>
                        <button type="button" class="account-item__btn account-item__btn--delete" data-action="delete-account" data-account-id="${account.id}">刪除</button>
                    </div>
                </div>
                <div class="account-item__details">
                    ${details}
                </div>
            </div>
        `;
    }).join('');
}

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

function cancelAccountForm() {
    if (!accountForm) return;
    accountForm.style.display = 'none';
    if (accountsList) accountsList.style.removeProperty('display');
}

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
            const oldAccount = currentAccounts.find(a => a.id === accountId);
            const oldName = oldAccount?.name;

            const { error } = await supabase
                .from('accounts')
                .update(accountData)
                .eq('id', accountId);

            if (error) throw error;

            if (oldName && oldName !== name) {
                await updateTransactionPaymentMethods(oldName, name);
            }
        } else {
            const { error } = await supabase
                .from('accounts')
                .insert(accountData);

            if (error) throw error;
        }

        cancelAccountForm();
        await loadSettingsData();
    } catch (error) {
        reportError(error, '儲存帳戶失敗，請稍後再試。');
    }
}

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
        reportError(error, '刪除帳戶失敗，請稍後再試。');
    }
}

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
        reportError(error, '更新交易支付方式失敗，請稍後再試。');
    }
}
