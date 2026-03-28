# Smart Finance Tracker

A React + Supabase personal finance app for transaction tracking, split expenses, streak goals, and customizable themes.

## Features

- **Transaction tracking** - Add, edit, and delete income/expense records with date, category, account, and notes
- **Split expenses** - Create groups, invite members with join code, track expenses, and view settlement suggestions
- **Credit card reminders** - Push reminders for payment due dates and usage threshold alerts
- **Daily streak** - Keep a no-spend streak with check-in support and streak calendar visualization
- **Customizable UI** - Multiple app themes, responsive layout, and mobile-friendly interactions
- **Bilingual changelog** - In-app release notes from `CHANGELOG.zh.md` and `CHANGELOG.en.md`

## Tech Stack

- **Frontend:** React 18, React Router, Vite
- **Data/Auth:** [Supabase](https://supabase.com) (PostgreSQL + Auth + Edge Functions)
- **Charts:** Chart.js + react-chartjs-2
- **Testing:** Vitest + jsdom

## Requirements

- Node.js 18+ (recommended)
- npm
- A Supabase project

## Quick Start

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

### 3) Set up database/functions

1. Create a Supabase project.
2. Run SQL setup scripts in Supabase SQL Editor:
   - `database/supabase-migration.sql`
   - `database/supabase-functions.sql`
3. If you use exchange-rate automation, follow docs in `docs/QUICK_START.md`.

### 4) Run the app

```bash
npm run dev
```

Open the local URL shown by Vite (typically `http://localhost:5173`).

## Scripts

- `npm run dev` - Start local development server
- `npm run build` - Build production bundle
- `npm run preview` - Preview the production build locally
- `npm run test` - Run test suite once
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

## Project Structure

```text
.
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── components/      # UI components by domain (auth, dashboard, split, settings, etc.)
│   ├── contexts/        # Global providers (toast, confirm, auth actions)
│   ├── hooks/           # Reusable hooks and feature hooks
│   ├── lib/             # Shared business logic and utilities
│   ├── pages/           # Route-level pages (dashboard, auth, split, join split)
│   └── styles/          # Global/component styles and themes
├── public/
├── supabase/
│   └── functions/       # Edge Functions (e.g., exchange rates, notifications)
├── database/            # SQL schema/functions setup
├── docs/                # Setup and maintenance guides
└── CHANGELOG.zh.md / CHANGELOG.en.md
```

## Documentation

- `docs/QUICK_START.md` - Exchange-rate deployment quick start
- `docs/EXCHANGE_RATE_SETUP_GUIDE.md` - Full exchange-rate setup
- `docs/REMINDER_SETUP_GUIDE.md` - Reminder/push notification setup
- `docs/MIGRATION_GUIDE.md` - Supabase migration workflow
- `docs/TESTING_CHECKLIST.md` - Testing checklist

## License

Private / personal use.
