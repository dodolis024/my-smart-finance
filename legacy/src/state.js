/**
 * Smart Expense Tracker - 全域狀態與 DOM 參考
 */

// Current State
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

// DOM Elements
const elements = {
    totalIncome: document.getElementById('totalIncome'),
    totalExpense: document.getElementById('totalExpense'),
    balance: document.getElementById('balance'),
    transactionList: document.getElementById('transactionList'),
    categorySelect: document.getElementById('category'),
    monthSelect: document.getElementById('monthSelect'),
    addBtn: document.getElementById('addBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    formSectionTitle: document.getElementById('formSectionTitle'),
    categoryChart: document.getElementById('categoryChart'),
    categoryStats: document.getElementById('categoryStats'),
    paymentStats: document.getElementById('paymentStats'),
    dateInput: document.getElementById('date'),
    itemInput: document.getElementById('item'),
    methodInput: document.getElementById('method'),
    currencyInput: document.getElementById('currency'),
    amountInput: document.getElementById('amount'),
    noteInput: document.getElementById('note'),
    streakBadge: document.getElementById('streakBadge'),
    reactionModal: document.getElementById('reactionModal'),
    reactionTitle: document.getElementById('reactionTitle'),
    reactionText: document.getElementById('reactionText'),
    streakCalendarRoot: document.getElementById('streakCalendarRoot'),
    reactionCloseBtn: document.getElementById('reactionCloseBtn'),
    checkinBtn: document.getElementById('dailyCheckinBtn'),
    formSection: document.querySelector('.transaction-form-section'),
    formColumn: document.querySelector('.form-column'),
    dashboardColumn: document.querySelector('.dashboard-column'),
};

// Chart.js instance
let expenseChart = null;

// State
let currentTransactions = [];
let transactionHistoryFull = [];
let selectedFilterCategories = [];
let selectedFilterPaymentMethods = [];
let editingId = null;
let filterPopover = null;
let filterPopoverAnchor = null;
let filterPopoverScrollHandler = null;
let filterPopoverIgnoreScrollUntil = 0;
let currentAccounts = [];

let streakState = {
    count: 0,
    broken: false,
    totalDays: 0,
    longestStreak: 0,
    loggedDates: []
};
let streakInitialHandled = false;
let streakCalendarYear = null;
let streakCalendarMonth = null;
let streakBadgeOriginalParent = null;

// Chart colors
const CHART_COLORS = [
    'hsl(11, 36%, 60%)',
    'hsl(26, 36%, 60%)',
    'hsl(41, 36%, 60%)',
    'hsl(54, 36%, 58%)',
    'hsl(67, 36%, 60%)',
    'hsl(80, 36%, 60%)',
    'hsl(93, 36%, 60%)',
    'hsl(106, 36%, 60%)',
    'hsl(119, 36%, 60%)'
];
