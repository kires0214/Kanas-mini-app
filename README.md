# Kanas — Telegram Mini App

MVP for renting football pitches in Kazakhstan: Telegram authentication, field/date/time selection,
transaction-safe one-hour bookings, manual Kaspi Pay verification, administration and bot notifications.

## Hosting choice

Railway: one Next.js app service plus one PostgreSQL service. There is no dedicated Telegram worker
or bot process in this MVP; the app uses the Telegram Bot API to send best-effort notifications.

## Booking and payment flow

1. Customer opens the Mini App from the Telegram bot's menu button; Telegram supplies signed initData.
2. Every API request validates Telegram initData with the secret bot token and checks freshness.
3. Customer selects a field, calendar date and free one-hour timeslot in Kazakhstan time (Asia/Almaty).
4. The server holds the slot for **20 minutes**. PostgreSQL prevents concurrent overlapping bookings.
5. Customer opens the **merchant-provided HTTPS Kaspi Pay link** and presses **Я оплатил**.
6. The booking transitions to **review** and remains unavailable to other customers.
7. Administrator checks the bank receipt **outside the app**, then confirms or rejects the booking.
8. The decision appears under **Мои брони**; Telegram notification is attempted when the user has started the bot.

**Manual verification is not optional.** A customer pressing **Я оплатил** is not proof of payment.
The generic Kaspi Pay merchant link does not prove who paid for which booking, or that the correct
amount was received. The administrator must match the actual payment and resolve ambiguous cases.

## Setup

Prerequisites: Node.js 22+, PostgreSQL, a Telegram bot from BotFather, valid merchant Kaspi Pay link.

1. Copy .env.example to .env and set the four environment variables below.
2. Install: npm install
3. Apply versioned schema: npm run db:migrate (DATABASE_URL must be set).
4. Develop: npm run dev (Telegram requires a public HTTPS URL; use a secure dev tunnel).
5. For Railway, connect this GitHub repository as the Next.js service and provision a PostgreSQL
   service in the **same Railway project**. Supply DATABASE_URL with its Railway service reference.
6. Generate an HTTPS public domain for the app service.
7. In the Telegram account for your bot, open @BotFather and configure /setmenubutton with the HTTPS URL.
   The bot's user must tap **Start** before it can receive direct notification messages.
8. Enter the administrator Telegram ID in ADMIN_TELEGRAM_IDS; open the app via that account,
   go to **Админ**, and create the fields with their actual names, prices and opening hours.
9. Verify: npm run typecheck, npm test, npm run build.

### Environment variables

| Key | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection string. Never place real credentials in Git. |
| TELEGRAM_BOT_TOKEN | Secret BotFather token; verifies Telegram identity and sends messages. |
| ADMIN_TELEGRAM_IDS | Comma-separated numeric Telegram IDs authorized for bank payment review. |
| KASPI_PAYMENT_URL | Real merchant-issued HTTPS payment URL; no fabricated payment details. |

The application is intentionally not seeded with fictitious pitches or bank details.
Fields are created by the administrator.

## API

- GET /api/health — database readiness
- GET /api/me — verified Telegram identity, admin flag and configured payment link
- GET /api/fields — currently active pitches
- GET /api/availability?fieldId=1&date=2026-11-07 — available one-hour slots
- GET and POST /api/bookings — customer's booking history and new time-limited booking
- POST /api/bookings/:id/paid — customer declares payment, booking enters review
- GET /api/admin/bookings — admin queue
- POST /api/admin/bookings/:id/decision — authorized admin confirms or rejects
- GET, POST and PATCH /api/admin/fields — admin pitch management

All endpoints except the readiness check require signed Telegram initData; admin actions also
require a matching trusted Telegram ID.

## Scope and release safety

- Atomic PostgreSQL exclusion constraint prevents overlapping active bookings per field.
- Expired unpaid holds are cleaned opportunistically on availability or booking requests.
- Users can hold at most five pending/review slots. Further anti-abuse limits can be added later.
- After the customer marks payment, the slot stays held until the admin reviews the actual receipt.
- Admin decisions are recorded in the database.
- The MVP intentionally omits refunds, automated bank integration, SMS, recurring bookings,
  flexible durations, cancellation self-service, CRM, analytics, images and marketing pages.
- Telegram messages are best-effort: the bot may be unable to DM a user who did not press Start.
- No secrets or payment credentials are committed to Git.
- Configure backups, a separate test environment, monitoring and privacy policy before real customers.

## QA release gate

Run all checks on a test Railway environment and separate test PostgreSQL database, with a test
Telegram bot and non-production payment URL. In addition to the unit tests and CI build,
exercise concurrent booking attempts on the same field/time (only one must succeed), consecutive
hours, 20-minute expiry, review not automatically confirming payment, admin authorization
(403 for customers), confirmed/rejected decision notifications and Kazakhstan timezone behavior.

GitHub CI executes TypeScript typecheck, unit tests, real PostgreSQL 18 integration/concurrency tests,
Next.js build and a production HTTP booking/payment smoke test. Telegram transport is mocked in QA.
**CI by itself does not prove live DB integration or external Telegram/BotFather configuration.**
Do not enable production users before those end-to-end checks.

See [deployment and operating guide](docs/RELEASE.md) for Railway `simple-field-management`,
versioned migrations, request idempotency, disputed/late payments, durable notification retries and launch gates.
