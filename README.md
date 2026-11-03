# Smart Finance Tracker

A React + Supabase personal finance app for tracking transactions, analysing spending, splitting expenses with friends, and building a daily logging habit. Also comes with a command-line tool so you (or an AI assistant) can log and look up transactions from the terminal.

Current version: **1.34.2** — see [`CHANGELOG.en.md`](CHANGELOG.en.md) / [`CHANGELOG.zh.md`](CHANGELOG.zh.md).

## Features

### Tracking
- **Transactions** - Add, edit, and delete income/expense records with date, time, category, account, and notes; search and filter the list
- **Multi-currency** - Foreign-currency entries are converted to TWD at that date's exchange rate, updated automatically every day
- **Overseas fees** - Set a fee rate on a card, tick "Overseas" when recording, and the fee is added to that entry
- **Accounts** - Track balances for cash and debit accounts; deactivate a cancelled card while keeping its history
- **Subscriptions** - Recurring transactions (monthly or yearly) that are recorded automatically on schedule
- **Offline mode** - Entries made offline are kept on the device and sync when you're back online
- **Export** - Download transactions as CSV for any date range

### Analysis
- **Dashboard** - Monthly or yearly totals, category pie chart, and payment-method breakdown
- **Spending analysis** (desktop) - Compare this month with your usual month, see which categories drive the difference, list large purchases, and group trip expenses
- **Yearly review** - A story-style recap of your year, with shareable image cards

### Split expenses
- **Groups** - Create a group, invite members with a join code, and record shared expenses in any currency
- **Settle up** - Settlement suggestions showing who pays whom
- **Sync to your ledger** - Add your share of a group's expenses to your own transactions in one tap; re-syncing keeps the names, categories, and notes you changed

### Habits & reminders
- **Daily streak** - Check in by logging each day, with a streak calendar and freeze cards that protect your streak
- **Credit card reminders** - Push notifications for payment due dates and usage-limit alerts

### Interface
- **Bilingual UI** - Traditional Chinese and English, synced across devices
- **Themes** - 8 themes (dawn, graphite, rose, soda, sorbet, peach, lime, lavender)
- **Responsive** - Works on desktop and mobile, installable as a web app
- **Sign-in** - Email + password or Google account
- **In-app changelog** - Release notes in both languages

## Quick Start

### 0) Requirements

- Node.js 18+
- npm
- A [Supabase](https://supabase.com) project

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create `.env.local` in the project root:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
# Optional: needed for web push notifications
VITE_VAPID_PUBLIC_KEY=your_web_push_vapid_public_key
```

### 3) Set up the database

> **Setting up a new database from scratch is not supported yet.** The SQL files in this repo are the step-by-step change history of the production database, not a clean install script. Many of them were edited after later files replaced parts of them, so no run order rebuilds the current schema on an empty project (tested on a fresh local Supabase, Nov 2026).

What's in the repo:

- `database/supabase-migration.sql` and `database/supabase-functions.sql` - The original base tables and functions
- `database/*-migration.sql` - Feature migrations (split expenses, subscriptions, account balances, streak freezes, ...), each applied once to production
- `supabase/migrations/` - The push notification subscriptions table
- `scripts/` - One-off fixes and status checks run against production

Automatic exchange rates, reminders, and subscriptions also need the Edge Functions in `supabase/functions/` deployed with their schedules — see [Documentation](#documentation).

### 4) Run the app

```bash
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the local development server |
| `npm run build` | Build the production bundle |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Check code style (fails on any warning) |
| `npm run lint:fix` | Fix code style issues automatically |
| `npm run test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with a coverage report |

## Command-line tool

The `finance` CLI is published on npm as [`my-smart-finance-cli`](https://www.npmjs.com/package/my-smart-finance-cli). It logs and looks up transactions and split expenses from the terminal, and every query supports `--json` for AI assistants and scripts.

```bash
npm install -g my-smart-finance-cli
```

Source code and development notes are in [`tools/README.md`](tools/README.md).

## Tech Stack

- **Frontend:** React 18, React Router, Vite
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions, scheduled jobs)
- **Charts:** Chart.js + react-chartjs-2
- **Testing:** Vitest + jsdom
- **Hosting & CI:** GitHub Pages and GitHub Actions (`.github/workflows/`)

## Project Structure

```text
.
├── src/
│   ├── components/      # UI components by feature (dashboard, transactions, split,
│   │                    #   spending-analysis, yearly-review, streak, settings, ...)
│   ├── contexts/        # Global providers (auth, language, toast, confirm, nav actions)
│   ├── hooks/           # Reusable and feature hooks
│   ├── lib/             # Shared business logic and utilities
│   ├── locales/         # Translations (zh.js, en.js)
│   ├── pages/           # Route-level pages (dashboard, spending analysis, yearly review,
│   │                    #   split, join split, auth, password reset)
│   └── styles/          # Global and component styles, themes
├── public/              # Static files, web app manifest, service worker
├── supabase/functions/  # Edge Functions (exchange rates, subscriptions, reminders, split notifications)
├── supabase/migrations/ # Push notification subscriptions table
├── database/            # Base schema and feature migrations (production change history)
├── scripts/             # Production maintenance: backups, fixes, status checks
├── tools/               # Command-line tool (published to npm)
├── tests/unit/          # Unit tests
├── config/              # Test configuration
├── docs/                # Setup and maintenance guides
└── CHANGELOG.zh.md / CHANGELOG.en.md
```

## Documentation

- `docs/DEPLOYMENT.md` - Production status, backups, and restore steps
- `docs/CONFIG_TEMPLATE.md` - Placeholders to fill in for the exchange-rate setup
- `docs/QUICK_START.md` - Exchange-rate deployment quick start
- `docs/EXCHANGE_RATE_SETUP_GUIDE.md` - Full exchange-rate setup
- `docs/REMINDER_SETUP_GUIDE.md` - Reminder and push notification setup
- `docs/TESTING_CHECKLIST.md` - Manual testing checklist
- `docs/MIGRATION_GUIDE.md` - Original move from Google Sheets to Supabase (historical)

## License

[MIT](LICENSE)
