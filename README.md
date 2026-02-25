# Smart Finance Tracker

A lightweight personal expense tracker with authentication, multi-currency support, and gamified streak goals.

## Features

- **Transaction tracking** — Log expenses and income with date, category, payment method, and notes
- **Categories & accounts** — Manage custom expense/income categories and payment methods
- **Daily check-in** — "Today no spend" button to maintain streak when you have no transactions
- **Streak calendar** — Visual calendar showing your consecutive days of tracking
- **Charts** — Pie chart visualization of spending by category
- **Multi-currency** — Automatic exchange rates via [exchangerate-api.com](https://www.exchangerate-api.com/) (Supabase Edge Function updates daily)
- **Auth** — Sign up, sign in, sign out (Supabase Auth)

## Tech Stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL, Auth, Edge Functions)
- **External API:** [ExchangeRate-API](https://www.exchangerate-api.com/) for currency rates

## Quick Start

### 1. Set up Supabase

1. Create a [Supabase](https://supabase.com) project.
2. Run `database/supabase-migration.sql` and `database/supabase-functions.sql` in the Supabase SQL Editor to create tables and functions.
3. Add your Supabase URL and anon key in `src/config.js` and `auth.html` (Dashboard → Settings → API). These are safe in the frontend; Supabase RLS protects your data.

### 2. Run locally

```bash
npx serve .
# or
python -m http.server 8000
```

Open `auth.html` to sign in or register, then `index.html` for the main app.

### 3. (Optional) Auto-update exchange rates

See `docs/QUICK_START.md` and `docs/EXCHANGE_RATE_SETUP_GUIDE.md` for deploying the exchange-rate cron job.

## Project Structure

```
├── index.html              # Main app
├── auth.html               # Login / signup
├── styles/                 # CSS (main.css + imports)
│   ├── main.css
│   ├── variables.css
│   ├── base.css
│   ├── layout.css
│   ├── responsive.css
│   └── components/         # form, table, modal, badge
├── src/                    # JavaScript modules
│   ├── constants.js        # Global constants (layout breakpoints, timing, etc.)
│   ├── config.js           # Supabase config
│   ├── utils.js            # Utility functions
│   ├── state.js            # Global state & DOM references
│   ├── auth.js             # Authentication logic
│   ├── streak.js           # Streak tracking & calendar
│   ├── dashboard.js        # Dashboard rendering & charts
│   ├── transactions.js     # Transaction CRUD
│   ├── settings.js         # Settings modal (categories, accounts)
│   ├── main.js             # App initialization & event listeners
│   └── ui/                 # UI components
│       ├── filters.js      # Table filtering & rendering
│       ├── swipe.js        # Mobile swipe gestures
│       └── modals.js       # Modal dialogs
├── database/               # SQL scripts
│   ├── supabase-migration.sql
│   └── supabase-functions.sql
├── config/                 # Build & test config
│   ├── tsconfig.json
│   ├── vitest.config.js
│   └── vitest.setup.js
├── scripts/                # Exchange rate setup scripts
├── supabase/
│   └── functions/
│       └── update-exchange-rates/   # Edge Function for daily rates
└── docs/                   # Guides and checklists
```

## Documentation

- `docs/QUICK_START.md` — Exchange rate deployment (3 steps)
- `docs/EXCHANGE_RATE_SETUP_GUIDE.md` — Full exchange rate setup
- `docs/CONFIG_TEMPLATE.md` — Config and env var notes
- `docs/MIGRATION_GUIDE.md` — Supabase migration steps

## License

Private / personal use.
