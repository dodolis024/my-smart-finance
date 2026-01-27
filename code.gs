/**
 * Google Sheets Expense Tracker — Backend (code.gs)
 * 費用追蹤器 — 後端
 *
 * This file contains: setup, Web App entry, and API logic for the expense tracker.
 * 此檔包含：設定、網路應用程式進入點，以及費用追蹤的 API 邏輯。
 */

// =============================================================================
// 1. WEB APP ENTRY POINTS / 網路應用程式進入點 (doGet, doPost)
// =============================================================================

/**
 * doGet(e)
 * Routes GET by query.action:
 * - action=getDashboardData: returns JSON from getDashboardData(year, month).
 * - otherwise: returns plain text (做法 B：前端由靜態託管，GAS 僅作 API，不需 index.html)。
 *
 * @param {GoogleAppsScript.Events.DoGet} e - The doGet event (e.parameter = query string)
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'getDashboardData') {
    const result = getDashboardData(params.year, params.month);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(
    'Smart Expense Tracker API. GET: ?action=getDashboardData&year=YYYY&month=M. POST: addTransaction (JSON body).'
  ).setMimeType(ContentService.MimeType.TEXT_PLAIN);
}

/**
 * doPost(e)
 * Parses JSON from e.postData.contents.
 * - If data.action === 'delete': calls deleteTransaction(data.id).
 * - Otherwise (including 'add' or omitted): calls addTransaction(data).
 *
 * @param {GoogleAppsScript.Events.DoPost} e - The doPost event (e.postData.contents = JSON body)
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  let data;
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    data = JSON.parse(raw);
  } catch (err) {
    const result = { success: false, error: 'Invalid JSON in request body: ' + (err.message || String(err)) };
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (data && data.action === 'delete') {
    return ContentService.createTextOutput(JSON.stringify(deleteTransaction(data.id))).setMimeType(ContentService.MimeType.JSON);
  }
  if (data && data.action === 'edit') {
    return ContentService.createTextOutput(JSON.stringify(editTransaction(data))).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify(addTransaction(data))).setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// 2. SHEET SETUP / 試算表結構設定
// =============================================================================

/** Sheet tab names / 試算表分頁名稱 */
const SHEET_NAMES = {
  TRANSACTIONS: 'Transactions',
  ACCOUNTS: 'Accounts',
  SETTINGS: 'Settings',
};

/**
 * setupSheet()
 * Creates the 3 required tabs (Transactions, Accounts, Settings) if they don't exist.
 * Pre-fills headers and default data. Safe to run multiple times.
 *
 * 若以下三個分頁不存在則建立：Transactions、Accounts、Settings。
 * 預填標題列與預設資料。可重複執行而不會重複建立。
 */
function setupSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // --- Tab 1: Transactions (Log) / 交易紀錄 ---
    let transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    if (!transactionsSheet) {
      transactionsSheet = ss.insertSheet(SHEET_NAMES.TRANSACTIONS);
      const transactionsHeaders = [
        'ID',
        'Date',
        'Item Name',
        'Category',
        'Payment Method',
        'Currency',
        'Original Amount',
        'Exchange Rate',
        'TWD Amount',
        'Note',
      ];
      transactionsSheet.getRange(1, 1, 1, transactionsHeaders.length).setValues([transactionsHeaders]);
      transactionsSheet.getRange(1, 1, 1, transactionsHeaders.length).setFontWeight('bold');
    }

    // --- Tab 2: Accounts (Status) / 帳戶狀態 ---
    let accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    if (!accountsSheet) {
      accountsSheet = ss.insertSheet(SHEET_NAMES.ACCOUNTS);
      const accountsHeaders = [
        'Account Name',
        'Type (Cash/Bank/Credit Card)',
        'Credit Limit',
        'Billing Day',
        'Payment Due Day',
        'Current Balance (Formula)',
      ];
      accountsSheet.getRange(1, 1, 1, accountsHeaders.length).setValues([accountsHeaders]);
      accountsSheet.getRange(1, 1, 1, accountsHeaders.length).setFontWeight('bold');
      // Pre-fill default accounts / 預填預設帳戶
      const defaultAccounts = [
        ['Cash', 'Cash', '', '', '', ''],
        ['Credit Card 1', 'Credit Card', '50000', '5', '25', ''],
      ];
      // getRange(row, col, numRows, numCols) — 3rd is numRows, not endRow
      accountsSheet.getRange(2, 1, defaultAccounts.length, 6).setValues(defaultAccounts);
    }

    // --- Tab 3: Settings (Config & Rates) / 設定與匯率 ---
    let settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
      const settingsHeaders = ['Key', 'Value'];
      settingsSheet.getRange(1, 1, 1, 2).setValues([settingsHeaders]);
      settingsSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
      // Pre-fill exchange rates and categories / 預填匯率與類別
      settingsSheet.getRange(2, 1).setValue('TWD');
      settingsSheet.getRange(2, 2).setValue(1);
      settingsSheet.getRange(3, 1).setValue('USD');
      settingsSheet.getRange(3, 2).setFormula('=GOOGLEFINANCE("CURRENCY:USDTWD")');
      settingsSheet.getRange(4, 1).setValue('JPY');
      settingsSheet.getRange(4, 2).setFormula('=GOOGLEFINANCE("CURRENCY:JPYTWD")');
      settingsSheet.getRange(5, 1).setValue('EUR');
      settingsSheet.getRange(5, 2).setFormula('=GOOGLEFINANCE("CURRENCY:EURTWD")');
      settingsSheet.getRange(6, 1).setValue('GBP');
      settingsSheet.getRange(6, 2).setFormula('=GOOGLEFINANCE("CURRENCY:GBPTWD")');
      settingsSheet.getRange(7, 1).setValue('Categories');
      settingsSheet.getRange(7, 2).setValue('Food,Transport,Entertainment,Shopping,Bills');
      // D＝支出類別、E＝收入類別（分開管理，避免日後增減時互相影響）
      settingsSheet.getRange(1, 4).setValue('支出類別');
      settingsSheet.getRange(1, 5).setValue('收入類別');
      settingsSheet.getRange(2, 4, 6, 1).setValues([
        ['飲食'], ['飲料'], ['交通'], ['娛樂'], ['購物'], ['其他']
      ]);
      settingsSheet.getRange(2, 5, 2, 1).setValues([['薪水'], ['投資']]);
    }

    return { success: true, message: 'Sheets setup completed.' };
  } catch (err) {
    Logger.log('setupSheet error: ' + err.message);
    throw err;
  }
}

// =============================================================================
// 3. API: addTransaction / 新增交易
// =============================================================================

/**
 * addTransaction(data)
 * Adds a new transaction row. Looks up exchange rate, computes TWD amount, generates UUID.
 *
 * 新增一筆交易列。依貨幣從 Settings 查匯率、計算 TWD 金額、產生 UUID。
 *
 * @param {Object|string} data - JSON object or string: { date, item, category, method, currency, amount, note }
 * @returns {{ success: boolean, message?: string, error?: string }}
 */
function addTransaction(data) {
  try {
    // Support both object and JSON string (e.g. from doPost) / 支援物件或 JSON 字串
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    const { date, item, category, method, currency, amount, note } = d;

    if (!date || item == null || !category || !method || !currency || amount == null) {
      return { success: false, error: 'Missing required fields: date, item, category, method, currency, amount.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    if (!settingsSheet || !transactionsSheet) {
      return { success: false, error: 'Sheets "Settings" or "Transactions" not found. Run setupSheet() first.' };
    }

    // Look up exchange rate from Settings (Key = currency) / 從 Settings 依 Key=貨幣 查匯率
    const settingsData = settingsSheet.getDataRange().getValues();
    let exchangeRate = 1;
    for (let i = 1; i < settingsData.length; i++) {
      if (String(settingsData[i][0]).trim().toUpperCase() === String(currency).trim().toUpperCase()) {
        const val = settingsData[i][1];
        // Handle number, or GOOGLEFINANCE 2-col result (date, rate) when in one cell
        // 處理數字，或 GOOGLEFINANCE 單格雙欄（日期、匯率）時取匯率
        if (typeof val === 'number' && !isNaN(val)) {
          exchangeRate = val;
        } else if (Array.isArray(val) && val.length > 1 && typeof val[1] === 'number') {
          exchangeRate = val[1];
        } else if (Array.isArray(val) && val.length && typeof val[0] === 'number') {
          exchangeRate = val[0];
        }
        break;
      }
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return { success: false, error: 'Invalid amount.' };
    }
    const twdAmount = numAmount * exchangeRate;
    const id = Utilities.getUuid();

    // Normalise date to YYYY-MM-DD / 將日期正規化為 YYYY-MM-DD
    let dateStr = String(date).trim();
    if (dateStr.includes('/')) {
      const p = dateStr.split('/');
      if (p.length >= 3) dateStr = `${p[0].padStart(4, '0')}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    }

    const row = [
      id,
      dateStr,
      String(item || ''),
      String(category || ''),
      String(method || ''),
      String(currency || ''),
      numAmount,
      exchangeRate,
      Math.round(twdAmount * 100) / 100,
      String(note || ''),
    ];
    transactionsSheet.appendRow(row);

    return { success: true, message: 'Transaction added successfully.' };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * deleteTransaction(id)
 * Deletes the Transactions row where Column A (ID) matches the given id.
 *
 * @param {string} id - The transaction ID (Column A)
 * @returns {{ success: boolean, error?: string }}
 */
function deleteTransaction(id) {
  try {
    if (!id || String(id).trim() === '') {
      return { success: false, error: 'Missing transaction ID.' };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    if (!sheet) {
      return { success: false, error: 'Transactions sheet not found.' };
    }
    const values = sheet.getDataRange().getValues();
    // Row 0 = header; search from row 1 (index 1)
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === String(id).trim()) {
        sheet.deleteRow(i + 1); // 1-based row number
        return { success: true };
      }
    }
    return { success: false, error: 'Transaction not found.' };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * editTransaction(data)
 * Updates the Transactions row where Column A (ID) matches data.id.
 * Re-fetches exchange rate and recalculates TWD Amount from amount + currency.
 *
 * @param {Object} data - { id, date, item, category, method, currency, amount, note }
 * @returns {{ success: boolean, error?: string }}
 */
function editTransaction(data) {
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    const { id, date, item, category, method, currency, amount, note } = d;

    if (!id || String(id).trim() === '') {
      return { success: false, error: 'Missing transaction ID.' };
    }
    if (!date || item == null || !category || !method || !currency || amount == null) {
      return { success: false, error: 'Missing required fields: date, item, category, method, currency, amount.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    if (!settingsSheet || !transactionsSheet) {
      return { success: false, error: 'Sheets "Settings" or "Transactions" not found.' };
    }

    // Look up exchange rate (same logic as addTransaction)
    const settingsData = settingsSheet.getDataRange().getValues();
    let exchangeRate = 1;
    for (let i = 1; i < settingsData.length; i++) {
      if (String(settingsData[i][0]).trim().toUpperCase() === String(currency).trim().toUpperCase()) {
        const val = settingsData[i][1];
        if (typeof val === 'number' && !isNaN(val)) {
          exchangeRate = val;
        } else if (Array.isArray(val) && val.length > 1 && typeof val[1] === 'number') {
          exchangeRate = val[1];
        } else if (Array.isArray(val) && val.length && typeof val[0] === 'number') {
          exchangeRate = val[0];
        }
        break;
      }
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return { success: false, error: 'Invalid amount.' };
    }
    const twdAmount = numAmount * exchangeRate;

    // Normalise date to YYYY-MM-DD
    let dateStr = String(date).trim();
    if (dateStr.includes('/')) {
      const p = dateStr.split('/');
      if (p.length >= 3) dateStr = p[0].padStart(4, '0') + '-' + p[1].padStart(2, '0') + '-' + p[2].padStart(2, '0');
    }

    const values = transactionsSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === String(id).trim()) {
        const rowNum = i + 1;
        // Update B:J (columns 2–10): Date, Item, Category, Method, Currency, Original Amount, Exchange Rate, TWD Amount, Note
        // getRange(startRow, startColumn, numRows, numColumns) → 1 row, 9 columns
        transactionsSheet.getRange(rowNum, 2, 1, 9).setValues([[
          dateStr,
          String(item || ''),
          String(category || ''),
          String(method || ''),
          String(currency || ''),
          numAmount,
          exchangeRate,
          Math.round(twdAmount * 100) / 100,
          String(note || ''),
        ]]);
        return { success: true };
      }
    }
    return { success: false, error: 'Transaction not found.' };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// =============================================================================
// 4. API: getDashboardData / 取得儀表板資料
// =============================================================================

/**
 * getDashboardData(year, month)
 * Returns summary, transaction history, accounts, and categories for the given month.
 *
 * 回傳該年月的摘要、交易紀錄、帳戶列表與類別列表。
 *
 * @param {number|string} year - e.g. 2023
 * @param {number|string} month - e.g. 10 (1–12)
 * @returns {Object} { summary: { totalIncome, totalExpense, balance }, history, accounts, categories }
 */
function getDashboardData(year, month) {
  try {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return { success: false, error: 'Invalid year or month.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    const accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);

    if (!transactionsSheet || !accountsSheet || !settingsSheet) {
      return { success: false, error: 'Required sheets missing. Run setupSheet() first.' };
    }

    // Column indices (0-based) / 欄位索引 (0 為 A 欄)
    const COL = { ID: 0, DATE: 1, ITEM: 2, CATEGORY: 3, METHOD: 4, CURRENCY: 5, ORIG: 6, RATE: 7, TWD: 8, NOTE: 9 };

    const transValues = transactionsSheet.getDataRange().getValues();
    const headers = transValues[0];
    if (!headers || headers[COL.DATE] !== 'Date' || headers[COL.TWD] !== 'TWD Amount') {
      return { success: false, error: 'Transactions sheet structure unexpected. Run setupSheet() first.' };
    }

    // -------------------------------------------------------------------------
    // Daily Streak (Habit Tracker) / 連續記帳天數
    // 規則：
    // - 收集 Transactions 內所有「唯一日期」(yyyy-MM-dd)
    // - 從「今天」或「昨天」開始嚴格往回連續計算
    // - 若今天或昨天有記帳 → streak alive
    // - 若今天與昨天都沒有記帳 → streak broken (0)，streakBroken=true
    // -------------------------------------------------------------------------
    const tz = Session.getScriptTimeZone();
    const baseNoon = new Date();
    baseNoon.setHours(12, 0, 0, 0); // avoid DST edge cases
    const todayStr = Utilities.formatDate(baseNoon, tz, 'yyyy-MM-dd');
    const yesterdayStr = Utilities.formatDate(new Date(baseNoon.getTime() - 86400000), tz, 'yyyy-MM-dd');

    const uniqueDateSet = new Set();
    for (let i = 1; i < transValues.length; i++) {
      const ds = _toYyyyMmDd(transValues[i][COL.DATE]);
      if (ds) uniqueDateSet.add(ds);
    }
    // Sorted dates (desc) for debugging / 符合需求：日期由新到舊排序
    const uniqueDatesDesc = Array.from(uniqueDateSet).sort((a, b) => b.localeCompare(a));

    const hasToday = uniqueDateSet.has(todayStr);
    const hasYesterday = uniqueDateSet.has(yesterdayStr);
    let streakCount = 0;
    let streakBroken = false;

    if (!hasToday && !hasYesterday) {
      streakCount = 0;
      streakBroken = true;
    } else {
      const startOffsetDays = hasToday ? 0 : -1; // start from today if present, otherwise yesterday
      for (let k = 0; k < 3650; k++) { // safety cap (~10 years)
        const expected = Utilities.formatDate(
          new Date(baseNoon.getTime() + (startOffsetDays - k) * 86400000),
          tz,
          'yyyy-MM-dd'
        );
        if (uniqueDateSet.has(expected)) streakCount++;
        else break;
      }
      streakBroken = false;
    }

    // --- 從 Settings 讀取：D＝支出類別、E＝收入類別（分開管理，避免增減時互相影響）---
    var expenseCategories = [];
    var incomeCategories = [];
    var settingsLastRow = settingsSheet.getLastRow();
    var numRows = Math.max(0, settingsLastRow - 1);
    if (numRows > 0) {
      var colD = settingsSheet.getRange(2, 4, numRows, 1).getValues();
      expenseCategories = colD
        .map(function(r) { return (r[0] != null && r[0] !== '') ? String(r[0]).trim() : ''; })
        .filter(function(s) { return s.length > 0; });
      var colE = settingsSheet.getRange(2, 5, numRows, 1).getValues();
      incomeCategories = colE
        .map(function(r) { return (r[0] != null && r[0] !== '') ? String(r[0]).trim() : ''; })
        .filter(function(s) { return s.length > 0; });
    }
    if (incomeCategories.length === 0) {
      incomeCategories = ['薪水', 'Salary', '投資', 'Investment'];
    }
    if (expenseCategories.length === 0) {
      var settingsData = settingsSheet.getDataRange().getValues();
      for (var si = 1; si < settingsData.length; si++) {
        if (String(settingsData[si][0] || '').trim() === 'Categories' && settingsData[si][1]) {
          expenseCategories = String(settingsData[si][1]).split(/,\s*/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
          break;
        }
      }
    }
    expenseCategories = expenseCategories.filter(function(c) { return incomeCategories.indexOf(c) === -1; });
    var categories = expenseCategories.concat(incomeCategories);

    var totalIncome = 0;
    var totalExpense = 0;
    const history = [];

    for (let i = 1; i < transValues.length; i++) {
      const row = transValues[i];
      const dateCell = row[COL.DATE];
      if (!dateCell) continue;

      // Parse date: support Date, string YYYY-MM-DD, or "MM/DD/YYYY" etc.
      // 解析日期：支援 Date 物件、字串 YYYY-MM-DD 或 MM/DD/YYYY 等
      const d = dateCell;
      if (typeof d === 'string') {
        if (d.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [yr, mo] = d.split('-').map(Number);
          if (yr !== y || mo !== m) continue;
        } else {
          const parsed = new Date(d);
          if (isNaN(parsed.getTime())) continue;
          if (parsed.getFullYear() !== y || parsed.getMonth() + 1 !== m) continue;
        }
      } else if (d instanceof Date && !isNaN(d.getTime())) {
        if (d.getFullYear() !== y || d.getMonth() + 1 !== m) continue;
      } else continue;

      const twd = parseFloat(row[COL.TWD]);
      const numTwd = isNaN(twd) ? 0 : twd;
      const cat = String(row[COL.CATEGORY] || '').trim();

      if (incomeCategories.indexOf(cat) !== -1) {
        totalIncome += numTwd;
      } else {
        totalExpense += numTwd;
      }

      history.push({
        id: row[COL.ID],
        date: typeof dateCell === 'string' ? dateCell : (dateCell instanceof Date ? Utilities.formatDate(dateCell, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(dateCell)),
        itemName: row[COL.ITEM],
        category: cat,
        paymentMethod: row[COL.METHOD],
        currency: row[COL.CURRENCY],
        originalAmount: row[COL.ORIG],
        exchangeRate: row[COL.RATE],
        twdAmount: numTwd,
        note: row[COL.NOTE],
        _row: i  // 試算表列序，愈大＝愈晚新增
      });
    }

    // 排序：1) 記帳日期愈新愈上面  2) 同一天內，愈晚新增（_row 愈大）愈上面
    history.sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      const byDate = db - da;
      if (byDate !== 0 && !isNaN(byDate)) return byDate;
      return (b._row || 0) - (a._row || 0);
    });

    // Get accounts / 取得帳戶
    const accountRows = accountsSheet.getDataRange().getValues();
    const accounts = [];
    for (let i = 1; i < accountRows.length; i++) {
      const r = accountRows[i];
      accounts.push({
        accountName: r[0],
        type: r[1],
        creditLimit: r[2],
        billingDay: r[3],
        paymentDueDay: r[4],
        currentBalanceFormula: r[5],
      });
    }

    const balance = totalIncome - totalExpense;

    return {
      success: true,
      summary: { totalIncome, totalExpense, balance },
      history,
      accounts,
      categories,
      categoriesExpense: expenseCategories,
      categoriesIncome: incomeCategories,
      streakCount: streakCount,
      streakBroken: streakBroken,
      // NOTE: `uniqueDatesDesc` is intentionally not returned (kept internal).
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// =============================================================================
// 5. ACCOUNTABILITY: checkDailyProgress / 記帳進度檢查（今日是否已記帳）
// =============================================================================

/**
 * checkDailyProgress()
 * If the last transaction date is not today, sends a reminder email to the sheet owner.
 * Use with a daily trigger (e.g. 20:00) so it runs once per day.
 *
 * 若最後一筆交易日期不是今天，則寄出提醒信給檔案擁有者。可搭配每日觸發（如 20:00）使用。
 */
function checkDailyProgress() {
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
  if (!transactionsSheet) return;

  const lastRow = transactionsSheet.getLastRow();
  // Row 1 = headers; no data rows -> remind
  if (lastRow <= 1) {
    _sendDailyReminderEmail(today);
    return;
  }

  // Date is column B (2). Get the last data row's date. / 日期在 B 欄
  const lastDateCell = transactionsSheet.getRange(lastRow, 2).getValue();
  const lastDateStr = _toYyyyMmDd(lastDateCell);
  if (lastDateStr === '') {
    _sendDailyReminderEmail(today);
    return;
  }

  if (lastDateStr !== today) {
    _sendDailyReminderEmail(today);
  }
}

/**
 * Normalises a date value to 'yyyy-MM-dd' for consistent comparison.
 * 將日期正規化為 yyyy-MM-dd，避免格式不一致造成誤判。
 *
 * @param {Date|string|number} val - Value from spreadsheet cell
 * @returns {string} 'yyyy-MM-dd' or ''
 */
function _toYyyyMmDd(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Sends the daily bookkeeping reminder email to the active user.
 * 寄出「今天還沒記帳」提醒信給目前使用者。
 *
 * @param {string} today - Today in 'yyyy-MM-dd'
 */
function _sendDailyReminderEmail(today) {
  const recipient = Session.getActiveUser().getEmail();
  const subject = '⚠️ 記帳提醒：今天還沒記帳喔！';
  const body = '哈嚕,\n\n系統偵測到有人今天 (' + today + ') 還沒有任何記帳紀錄紀錄😠。\n\n請記得叫他去補記帳！！！\n\n(這是自動發送的提醒)';
  MailApp.sendEmail(recipient, subject, body);
}
