# Changelog

This file records version updates for Smart Finance Tracker.

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
