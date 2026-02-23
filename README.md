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
2. Run `supabase-migration.sql` and `supabase-functions.sql` in the Supabase SQL Editor to create tables and functions.
3. Add your Supabase URL and anon key in `script.js` and `auth.html` (Dashboard → Settings → API). These are safe in the frontend; Supabase RLS protects your data.

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
├── index.html          # Main app
├── auth.html           # Login / signup
├── style.css
├── script.js
├── supabase-migration.sql
├── supabase-functions.sql
├── supabase/
│   └── functions/
│       └── update-exchange-rates/   # Edge Function for daily rates
├── scripts/            # Exchange rate setup scripts
└── docs/               # Guides and checklists
```

## Documentation

- `docs/QUICK_START.md` — Exchange rate deployment (3 steps)
- `docs/EXCHANGE_RATE_SETUP_GUIDE.md` — Full exchange rate setup
- `docs/CONFIG_TEMPLATE.md` — Config and env var notes
- `docs/MIGRATION_GUIDE.md` — Supabase migration steps

## License

Private / personal use.
