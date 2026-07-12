# Changelog

This file records version updates for Smart Finance Tracker.

## [1.21.2] - Jul-12 2026
- Added a push reminder when a subscription charge is skipped because the exchange rate is unavailable
- Improved transaction export: now a menu offering the current month, search results, or a custom month range as CSV
- Improved the cross-month search hint: shows the true total when matches exceed 200, and export still includes every match
- Improved custom split: unfilled members' placeholder amounts now match what is actually submitted, including the rounding remainder
- Strengthened split security: unauthenticated requests can no longer write member records via an invite code
- Fixed custom split amounts exceeding the total leaving other members with negative shares
- Fixed the missing-rate split error listing multiple currencies with a Chinese separator in the English UI

## [1.21.1] - Jul-11 2026
- Improved push notification and reminder email content for multi-language display
- Improved custom split: auto-split remainders no longer block submission with a total mismatch
- Fixed the longest streak possibly showing less than the current streak after freeze cards bridged missed days
- Fixed subscription charges and split sync possibly using a 1:1 exchange rate when none is available
- Fixed an interrupted split expense add potentially leaving an expense without shares
- Fixed re-synced ledger transactions keeping their old date, causing report drift
- Fixed split-bill error messages not following the interface language (Chinese text appearing in the English UI)
- Fixed the dashboard requiring a manual refresh to show a subscription's same-day charge
- Fixed an older offline preference choice possibly overwriting a newer one from another device
- Fixed credit usage over-counting the previous cycle in shorter months when the due day falls at month end

## [1.21.0] - Jul-10 2026
- Added cross-month transaction search to the transaction list
- Added CSV export for the transaction list, covering the current month or search results
- Improved the credit card spending status hint shown when viewing a month other than the current one
- Improved cross-month browsing by adding a quick "return to current month" button
- Fixed language/theme preferences being overwritten by stale data due to an async refresh race after switching

## [1.20.0] - Jul-09 2026
- Added a lock for the current year's Year in Review, showing a "coming at year end" message with a quick link back to past years until the year wraps up
- Added streak freeze cards: a missed day no longer breaks your logging streak when you have a card, and you earn cards automatically as your streak grows
- Improved the Year in Review dashboard banner to only appear in Jan-Feb the following year, prompting users to check out last year's recap

## [1.19.0] - Jul-09 2026
- Added offline support: the app now opens, shows last-seen data, and lets you record transactions while offline, syncing automatically once reconnected
- Added share/export for Year in Review story cards: save any card as an image to share or download
- Added cross-device sync for language and theme preferences: settings now follow your account
- Added a language switcher on the login page so you can choose your language before signing up
- Added a forgot password flow: a "Forgot password?" link on the login page lets users reset their password via email
- Improved loading performance for the dashboard, yearly review, and split pages
- Improved streak reminder delivery performance: batched checkin and email lookups and now filters out users without reminders enabled directly in the database, avoiding timeouts as user count grows
- Fixed the changelog unread indicator potentially breaking when the version number wasn't manually kept in sync, now reads the latest version directly
- Fixed transactions potentially disappearing silently when offline storage is full, and capped how many offline snapshots are kept
- Fixed a brief chance of seeing the previous user's data right after switching accounts
- Fixed subscription due-date checks possibly disagreeing with the backend on devices outside the Taiwan timezone
- Fixed the sidebar and bottom nav showing some labels (Home, Split, Year Review, Change log) in English even after switching to Chinese
- Fixed the language toggle button showing the target language instead of the current one
- Fixed Year in Review's month highlights losing a grid cell when only one month in the year has records, now shows a placeholder card instead

## [1.18.0] - Jul-06 2026
- Added Year in Review: swipeable story cards with annual totals, category rankings, top purchases, consistency stats, and best/overspent months, plus year-over-year income and expense comparison
- Added KRW support for split-bill currencies and exchange rate updates
- Added default currency setting in categories options for transactions and subscriptions
- Added split group archiving: archive inactive groups to hide them from the list and make them read-only
- Added yearly billing cycle for subscriptions with configurable renewal month
- Improved foreign currency display: zero-decimal currencies (e.g. JPY, KRW, TWD) no longer show unnecessary decimals
- Improved Year in Review copy, and fixed best/worst month labels showing incorrectly when the balance sign flips
- Strengthened account security: prevented unauthorized split group ownership changes and improved backend API authentication
- Fixed foreign currency transactions silently recorded at 1:1 rate when exchange rate is unavailable; now shows an error prompt instead
- Fixed editing a transaction sometimes overwriting the original TWD amount with today's exchange rate
- Fixed subscription billing dates appearing one day early in Taiwan timezone (UTC+8)
- Fixed subscription panel not loading expense categories correctly on open
- Fixed split expense and purchase dates showing a day off in some timezones
- Fixed credit card billing cycle calculation for billing days 29-31 in short months
- Fixed notification settings potentially leaking across accounts after switching users

## [1.17.2] - Jul-03 2026
- Improved cross-timezone streak reminders: auto-sync device timezone, full IANA timezone picker, and fixed missed reminders when traveling due to date-only dedup

## [1.17.1] - Apr-27 2026
- Improved desktop English transaction form title and check-in button layout to prevent wrapping and overflow

## [1.17.0] - Apr-19 2026
- Added zh/en language switching with app-wide localized strings and early html lang/data-lang from storage
- Fixed transaction detail modal crashing due to incorrect React hook ordering
- Fixed UserAvatar dropdown inert handling to clear React development DOM warnings

## [1.16.1] - Apr-04 2026
- Fixed transaction history table header and column alignment
- Fixed category and payment handling when editing split-bill transactions synced to the ledger

## [1.16.0] - Apr-03 2026
- Added split member renaming: tap to edit your own or unlinked members' display names in Manage members
- Improved add-expense calculator: better scroll to keep the field above the keypad; tap outside inputs to dismiss
- Added split-to-ledger sync: one-tap sync with unsynced/status/update flows
- Added split share detail view: inspect synced snapshots from both split page and transaction detail
- Improved split check-in integration: auto-upsert check-in when adding today's split expense

## [1.15.1] - Mar-29 2026
- Added group settings modal: edit group name, settlement currency and default recording currency, and allow linked members to update group settings

## [1.15.0] - Mar-29 2026
- Added optional default expense currency when creating a split group (independent of settlement currency)
- Improved add expense: custom split can auto-sum shares into the total, with physical keyboard support for the calculator
- Improved mobile scrolling: reliable clearance above the bottom tab bar and scrollbars that show while scrolling

## [1.14.1] - Mar-29 2026
- Improved add-expense calculator keypad: opening it scrolls the active field into view and reserves bottom space so inputs stay visible
- Improved split list on mobile: padding for the bottom tab bar and repositioned sticky tab-bar actions; app shell uses dynamic viewport height

## [1.14.0] - Mar-28 2026
- Added a split calculator keypad for entering expressions in expense amount and custom share fields.

## [1.13.1] - Mar-28 2026
- Improved split input experience: amount and custom share fields now support expression input.
- Improved mobile gesture interaction: refined direction detection between vertical scrolling and horizontal swipe.

## [1.13.0] - Mar-28 2026
- Improved split experience by extracting the join-group page, adding per-member spending summary and expandable records, and reorganizing split-related styles

## [1.12.1] - Mar-27 2026
- Fixed login not redirecting back to the intended page (e.g. when opening a split-bill group link)
- Improved split input UX on mobile: amount and custom share fields now use numeric keypad input
- Improved split list visuals: removed top-card rounded corners for a more consistent style

## [1.12.0] - Mar-26 2026
- Added credit card push alerts in Notification settings: payment due reminders and usage threshold warnings (requires push notifications)
- After recording or deleting a transaction on a credit card account, usage is rechecked and a push is sent when above your threshold

## [1.11.1] - Mar-24 2026
- Improved settings: moved “Check-in Reminder” and “Group Notifications” into “Notification Settings,” with collapsible subsections
- Improved theme settings: refined the theme picker and theme shuffle layout, with a collapsible shuffle section
- Improved mobile settings accordion: only one section opens at a time, and it auto-scrolls to the opened content
- Improved check-in reminder time wheel: reduced height and simplified layout to save space on small screens
- Improved settings tab layout: adjusted spacing between sections for easier reading

## [1.11.0] - Mar-23 2026
- Added new appearance themes and chart color schemes: Lavender, Orange Soda, Peach, Lime
- Added Web Push notifications for split-bill groups (enable via Settings → Group Notifications)
- Fixed changelog sometimes displaying outdated content
- Improved dashboard UX: transactions refresh immediately after deletion with background refresh to reduce flickering
- Improved split-bill group data loading performance
- Improved Graphite theme check-in calendar and streak circle visuals
- Improved random theme list layout and checkbox styling
- Fixed changelog unread indicator and check-in state interfering between multiple accounts
- Fixed payment method deletion to check for existing transactions and display a count warning
- Fixed transaction detail amount display to use currency prefix

## [1.10.0] - Mar-22 2026
- Added Dawn appearance theme (Rose Quartz × Serenity)
- Improved changelog loading stability to reduce stale or failed content
- Fixed some pages not applying the selected theme correctly
- Added Soda appearance theme
- Dawn theme now uses diamond 💎 icon instead of flame for streak
- Improved sidebar active state (when changelog / settings are open) and default expanded appearance section in settings
- Fixed duplicate theme initialization

## [1.9.0] - Mar-21 2026
- Added unread indicator for changelog (sidebar and bottom nav)
- Added appearance theme settings: random theme rotation with configurable frequency and theme pool
- Improved Graphite theme color palette and chart grayscale
- Fixed payment method potentially submitting twice on save

## [1.8.0] - Mar-19 2026
- Added Graphite (grayscale) appearance theme
- Improved split-bill group join flow: now uses invite codes for better privacy
- Fixed settlement amount display for zero-decimal currencies such as TWD and JPY

## [1.7.1] - Mar-17 2026
- Improved split billing: added member management, repayment records, and expense editing
- Improved navigation: added desktop sidebar and mobile bottom nav bar, integrated settings / changelog entry points

## [1.7.0] - Mar-11 2026
- Fixed Google avatar failing to show default initials when image fails to load
- Added split billing feature: create groups, add expenses, invite members, and view settlements

## [1.6.0] - Mar-11 2026
- Added theme switching, available in settings

## [1.5.0] - Mar-11 2026
- Improved check-in reminder email delivery reliability
- Improved settings panel: consolidated option management, check-in reminders, and subscription management into a single modal

## [1.4.1] - Mar-10 2026
- Fixed incorrect balance display in credit card balance management

## [1.4.0] - Mar-10 2026
- Fixed overlap between avatar and more-options menu when both are open
- Improved new user check-in badge display
- Fixed email line-break issue in desktop avatar dropdown
- Fixed accidental tap on empty area left of desktop "More Options" button
- Fixed garbled characters in check-in reminder email and prevented duplicate reminders on the same day
- Fixed login failure to show a friendly error message
- Added subscription management: create, edit, and disable subscriptions with automatic transaction generation

## [1.3.1] - Mar-10 2026
- Fixed check-in reminder potentially sending duplicate emails at certain times
- Improved reminder time picker to use a scroll-wheel interface
- Fixed login page getting stuck on loading when network is unavailable

## [1.3.0] - Mar-09 2026
- Added check-in reminder: users can set timezone and reminder time; system sends daily email to users who haven't checked in
- Added check-in reminder entry to menus (available on both desktop and mobile)

## [1.2.3] - Mar-09 2026
- Fixed illustrations not showing next to check-in calendar and dashboard stat cards

## [1.2.2] - Mar-01 2026
- Fixed streak-broken scolding popup not showing, and popup day count not updating after check-in

## [1.2.1] - Feb-28 2026
- Improved mobile transaction list swipe UX (4-column layout, swipe left to delete / right to edit)
- Fixed mobile avatar menu accessibility
- Added GitHub Pages auto-deployment
- Improved transaction table column display

## [1.2.0] - Feb-27 2026
- Rebuilt frontend for improved performance and maintainability
- Improved deployment stability

## [1.1.4] - Feb-25 2026
- Fixed multiple broken paths and streak day count display after refactor

## [1.1.3] - Feb-25 2026
- Fixed income and expense category label display issues

## [1.1.2] - Feb-24 2026
- Happy birthday to me 🥳
- Improved mobile filter UX

## [1.1.1] - Feb-23 2026
- Added user avatars
- Fixed option editing bug

## [1.1.0] - Feb-23 2026
- Added Changelog, accessible from the more-options menu
- Improved filter functionality
- Improved overall display experience

## [1.0.0] - Jan-15 2026
- Initial release
- Transaction tracking: income and expense entries with date, category, payment method, and notes
- Category and account management: custom expense/income categories, account types (including credit card settings)
- Daily check-in: check in on days with no spending to maintain streak
- Check-in calendar: visual display of tracking status and streak count
- Chart analysis: category pie chart and payment method breakdown
- Multi-currency support: automatic exchange rate updates (daily at 2:00 AM Taiwan time)
- Transaction filters: filter by category and payment method
- Mobile optimization: responsive layout, streak pinned to top, swipeable table
