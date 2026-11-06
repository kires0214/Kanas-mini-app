# MVP QA evidence — 2026-11-06

Baseline reviewed: `96d7361a16c1d6995b15e3fdf99f5c62180a9050`.
Implementation verified: `c6187ac1302b8a322ea49851be8be6c73baf9018`.
Existing PR: [#1](https://github.com/kires0214/Kanas-mini-app/pull/1).
Grouped CI: [MVP QA #3](https://github.com/kires0214/Kanas-mini-app/actions/runs/42210150954),
job `127866485709`, **success**.

| Check | Observed result |
| --- | --- |
| Clean install and TypeScript | Passed on Ubuntu, Node 22 |
| Unit tests | 10 passed, 0 failed |
| PostgreSQL 18 integration | 8 passed, 0 failed |
| Concurrent same-slot requests | 12 requests: 1 created, 11 HTTP 409 |
| Database overlap guarantee | Direct SQL overlap rejected with PostgreSQL `23P01` |
| Concurrent booking replay | 6 retries produced one booking ID; 1 HTTP 201 + 5 HTTP 200 |
| User pending limit | Concurrent requests permit 5 pending bookings, reject the sixth |
| Expiration and late payment | Expired hold releases slot; late claim is retained without replacing another customer |
| Manual payment | Paid enters review; only admin can confirm; dispute retains slot; conflicting final decisions rejected |
| ACL and isolation | Missing auth 401; customer admin requests 403; other customer's booking inaccessible |
| Rollback/error state | Unavailable hours, disabled fields and missing payment configuration leave no partial customer/booking |
| Notifications | Telegram failure retains outbox; subsequent mocked success marks delivery |
| Production build | Passed locally and in CI, Next.js 16.4.5 |
| Production HTTP flow | Page → signed auth → field → availability → booking → paid → admin confirmation → customer history and DB passed |
| Lifecycle | Owned HTTP child exited, port closed; CI Stop containers succeeded; lifecycle artifact uploaded |
| Dependency audit | Local `npm audit --omit=dev`: 0 vulnerabilities |

Local PostgreSQL, Docker/WSL, browsers and optional tool servers were not started.
Telegram transport is mocked in automated QA; HMAC authentication and PostgreSQL are real.
This does not claim an actual bank payment or a real Telegram-client session was tested.

## Railway TEST

[Project simple-field-management](https://railway.com/project/9136df7c-c1e5-4315-b350-cf9f347056da)
and [TEST app](https://kanas-app-test.up.railway.app).

- App deployment `ea635882-d1ec-479b-ab7f-0677b70a87d8`: SUCCESS.
- PostgreSQL deployment `f492269b-0de5-4a42-9ce1-fe0a7c140777`: SUCCESS.
- Environment status: 2 services online, 0 issues, no pending work.
- HTTPS `/`: 200; `/api/health`: 200 with `status=ok`; `/api/me` without signed initData: 401.
- Healthcheck proves the required schema migration is present in the actual Railway database.
- No seed fields, merchant link or live bot credentials were installed. No production deployment was made.

Follow-up grouped CI adds verification of upgrading an existing schema with retained booking data
and pins Railway/CI to the same Node 22 major. See the PR's current checks for that commit's result.

## Review findings addressed

PostgreSQL `to_char(time, text)` calls were invalid; field hours now use explicit text formatting.
The original schema could not be reapplied safely; migrations now have a transactional ledger and lock.
Booking creation now serializes per-user limits and replays request UUIDs safely across replicas.
Expired states are persisted, while review/dispute payments remain blocking without age-based removal.
The admin queue retains unresolved payments beyond match day. Rejections/disputes require an explanation,
late payments have a separate resolution path, and all decisions are audited.
Notification attempts are durable, awaited and inspectable instead of untracked fire-and-forget work.
The client clears stale slots, handles non-JSON/network errors and refreshes state after returning from payment.
Input parsing, duplicate Telegram parameters, private API caching and deployment readiness were tightened.

## Remaining owner inputs

Set TEST bot token, actual admin Telegram IDs and owner-supplied TEST payment URL in Railway Variables;
configure BotFather's menu for the TEST URL and perform the real mobile Telegram/payment/notification check.
For client launch, supply real field information, production credentials/payment URL, backups and separate
production authorization. These external owner inputs are not fabricated by the application.
