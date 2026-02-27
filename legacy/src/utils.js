/**
 * Smart Expense Tracker - 工具函數
 */

// Debounce 工具函數（用於 resize、scroll 等頻繁觸發的事件）
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * 統一錯誤回報：寫入 console 並顯示使用者可讀訊息
 */
function reportError(err, fallbackMessage) {
    const msg = err?.message || String(err) || fallbackMessage || '發生錯誤，請稍後再試。';
    console.error('Error:', err);
    alert(msg);
}

/**
 * Supabase 初始化檢查的 wrapper
 */
async function withSupabase(callback) {
    const supabase = getSupabase();
    if (!supabase) {
        reportError(new Error('Supabase 尚未初始化'), 'Supabase 尚未初始化，請重新整理頁面。');
        return;
    }
    try {
        return await callback(supabase);
    } catch (err) {
        reportError(err, '操作失敗，請稍後再試。');
        throw err;
    }
}

/**
 * 將 async 函數包裝為具統一錯誤處理的版本
 */
function asyncWithErrorHandler(asyncFn, fallbackMessage) {
    return async function(...args) {
        try {
            return await asyncFn.apply(this, args);
        } catch (err) {
            reportError(err, fallbackMessage);
        }
    };
}

function getTodayYmd() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatMoney(num) {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0 }).format(num);
}

function escapeHtml(s) {
    if (s == null) return '';
    const t = String(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNumberWithCommas(value) {
    const cleaned = value.replace(/[^\d.]/g, '');
    const parts = cleaned.split('.');
    let integerPart = parts[0] || '';
    const decimalPart = parts.length > 1 ? '.' + parts[1].slice(0, 2) : '';
    if (integerPart) {
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return integerPart + decimalPart;
}

function parseFormattedNumber(value) {
    return value.replace(/,/g, '');
}

/**
 * 關閉 modal/dropdown 前，將焦點移出該容器，避免 aria-hidden 與焦點衝突（無障礙規範）
 */
function moveFocusOutBeforeHide(container) {
    if (!container) return;
    const active = document.activeElement;
    if (active && container.contains(active) && typeof active.blur === 'function') {
        active.blur();
    }
}
