# AI Chat & Subscription Bundles

A TypeScript REST API with two domain modules: a **mocked AI chat** service with monthly
free quota, and a **subscription bundle** service with simulated billing.

Built with NestJS, TypeORM and PostgreSQL, laid out in Clean Architecture / DDD layers.

The original assessment brief is committed at [`docs/GGI-Backend-Test-Posture.pdf`](docs/GGI-Backend-Test-Posture.pdf).

---

## Table of contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Data model](#data-model)
- [How the quota rules work](#how-the-quota-rules-work)
- [How billing works](#how-billing-works)
- [API reference](#api-reference)
- [Walkthrough](#walkthrough-reproduce-every-rule-in-the-brief)
- [Testing](#testing)
- [Configuration](#configuration)
- [Design decisions & assumptions](#design-decisions--assumptions)
- [Project layout](#project-layout)

---

## Quick start

Requirements: **Node 20+** and **Docker** (for PostgreSQL).

```bash
git clone git@github.com:SoberSalman/GGI-Backend-Test-Posture.git
cd GGI-Backend-Test-Posture

npm install
cp .env.example .env

npm run setup      # docker compose up -d  +  migrations  +  seed
npm run start:dev
```

The API is at `http://localhost:3000/api/v1`, Swagger UI at
`http://localhost:3000/api/v1/docs`.

`npm run seed` prints four user ids. There is no auth module in this assessment
(see [Design decisions](#design-decisions--assumptions)), you identify yourself with
an `x-user-id` header:

```bash
curl http://localhost:3000/api/v1/users          # list the seeded ids

curl -X POST http://localhost:3000/api/v1/chat \
  -H "x-user-id: <paste an id>" \
  -H "content-type: application/json" \
  -d '{"question":"Explain database connection pooling."}'
```

### Seeded users

| User  | State |
|-------|-------|
| Alice | Brand new: 3 free messages, no bundles |
| Bob   | Free quota spent, one Basic bundle with 2 responses left |
| Carol | Free quota spent, Basic (1 left) **and** Pro (60 left) stacked |
| Dave  | Free quota spent, Enterprise bundle (unlimited) |

Carol is the interesting one: two live bundles means the selection policy has a real
choice to make.

### All commands

| Command | Purpose |
|---------|---------|
| `npm run setup` | Start Postgres, migrate, seed, everything in one go |
| `npm run start:dev` | Run with watch mode |
| `npm run build` / `npm run start:prod` | Compile and run the build |
| `npm test` | Unit tests |
| `npm run test:cov` | Unit tests with coverage report |
| `npm run test:e2e` | End-to-end tests against a real Postgres |
| `npm run lint` / `npm run format` | ESLint (zero warnings allowed) / Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migration:run` / `migration:revert` | Apply / roll back migrations |
| `npm run seed` | Reset the demo data |
| `npm run db:up` / `npm run db:down` | Postgres container up / down |

---

## What it does

### Module 1, AI chat

- Accepts a question, returns a **mocked** OpenAI response after a simulated network
  delay (randomised inside a configurable window, default 300–1200 ms).
- Persists the question, the answer, the model and the prompt / completion / total
  token counts.
- Tracks monthly usage per user: **3 free messages per month**, then a bundle is
  required.
- Supports **multiple active bundles per user** across three tiers, Basic (10),
  Pro (100), Enterprise (unlimited).
- Deducts from the bundle with the most remaining quota (see
  [the selection rule](#which-bundle-pays)).
- Free quota **resets on the 1st of each month**.
- Throws a **structured** `QUOTA_EXCEEDED` error carrying the numbers a client needs
  to render a paywall.

### Module 2, Subscription bundles

- Create a bundle: tier × billing cycle (monthly or yearly) × auto-renew on/off.
- Every bundle carries `maxMessages`, `price`, `startDate`, `endDate`, `renewalDate`.
- Simulated billing: auto-renews when the renewal date arrives; a **randomly failing**
  payment marks the bundle inactive.
- Cancellation ends the current billing cycle, prevents renewal, and preserves all
  usage and billing history.

---

## Architecture

Each module is a self-contained vertical slice with four layers. Dependencies only ever
point inward, the domain layer imports nothing from Nest, TypeORM or Express.

```
interface/          HTTP surface: controllers, DTOs, presenters
      │             (translates HTTP ⇄ application; never holds business rules)
      ▼
application/        Use cases and orchestration: services, outbound ports
      │             (transactions, sequencing; no SQL, no HTTP)
      ▼
domain/             Entities, value objects, policies, typed errors
      ▲             (the business rules, pure, framework-free, unit-testable)
      │
infrastructure/     Adapters: repositories, the mocked AI client, the payment
                    gateway, cron schedulers
```

The brief names the layers `domain/entities`, `services`, `repositories`,
`controllers`. Those map onto the directories above one-to-one:

| Brief | Directory | Example |
|-------|-----------|---------|
| `domain/entities` | `domain/` | `Subscription`, `FreeQuota`, `selectBundleToCharge` |
| `services` | `application/` | `ChatService`, `QuotaService`, `BillingService` |
| `repositories` | `infrastructure/` | `SubscriptionRepository`, `ChatMessageRepository` |
| `controllers` | `interface/` | `ChatController`, `SubscriptionController` |

The directory names follow the usual hexagonal convention so the outbound ports
have an obvious home, but the classes are named exactly as the brief describes.

### Ports and adapters

Three abstractions decouple the parts that would otherwise be hard to test or swap:

| Port | Adapter shipped | Why it exists |
|------|-----------------|---------------|
| `AiProvider` | `MockOpenAiProvider` | Swap for a real OpenAI client without touching a service |
| `PaymentGateway` | `SimulatedPaymentGateway` | Random declines in dev; a real PSP in production; a scripted double in tests |
| `SubscriptionQuotaPort` | `SubscriptionQuotaService` | Chat spends bundle quota **without** reaching into subscription tables |

`Clock` is a fourth, smaller port: every date-sensitive rule reads "now" through it, so
tests travel through time (month rollovers, renewal dates) without touching the system
clock or waiting.

### Module boundary

The chat module must be able to spend a bundle's quota, but it must not own the
subscription schema. `SubscriptionQuotaPort` lives in `shared/contracts/` and both
modules depend on **it** rather than on each other, a small anti-corruption layer that
also means there is no module cycle:

```
ChatModule ──────► SubscriptionQuotaPort ◄────── SubscriptionsModule
   (consumer)         (shared contract)              (implementation)
```

---

## Data model

```
users
  └─┬─ free_quotas        (1:1), this month's free-message counter
    ├─ chat_messages      (1:N), append-only Q&A + token history
    └─ subscriptions      (1:N), stacked bundles
         └─ payments      (1:N), append-only charge history
```

| Table | Notable columns |
|-------|-----------------|
| `free_quotas` | `periodKey` (`YYYY-MM`), `messagesUsed`, unique on `userId` |
| `subscriptions` | `tier`, `billingCycle`, `status`, `maxMessages` (null = unlimited), `messagesUsed`, `priceCents`, `autoRenew`, `startDate`, `endDate`, `renewalDate`, `cancelledAt`, `renewalCount`, `lastPaymentFailureReason` |
| `chat_messages` | `question`, `answer`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `quotaSource`, `subscriptionId`, `latencyMs` |
| `payments` | `kind` (INITIAL / RENEWAL), `status` (SUCCEEDED / FAILED), `amountCents`, `failureReason` |

Schema is managed by **migrations**, never `synchronize`, see
`src/migrations/`. Money is stored as integer **cents** and only formatted as a decimal
string at the edge; floats never touch a price.

### Subscription status

```
                       renewal charge succeeds
                    ┌──────────────────────────┐
                    │                          │
   create ──────► ACTIVE ──────────────────────┘
                    │  │
      cancel        │  │   renewal charge declines
   ┌────────────────┘  └───────────────────┐
   ▼                                       ▼
CANCELLED                               INACTIVE
   │  (still serves until endDate)          (stops serving at once)
   │
   ▼  endDate passes
EXPIRED
```

---

## How the quota rules work

### Order of payment

Free tier first, then bundles. A user should never burn paid quota while free messages
remain.

### Free quota reset

The counter row stores the month it belongs to (`periodKey`). Reads compare that key to
the current month and treat a stale row as **zero used**, so the allowance is already
correct at 00:00 on the 1st, even if no job ever runs. A cron at 00:05 UTC on the 1st
then rewrites stale rows in bulk, and `POST /billing/reset-free-quota` triggers the same
job on demand.

Belt and braces on purpose: the scheduled reset is a convenience, not the source of
truth. A missed cron run cannot hand a user a stale allowance.

### Which bundle pays

The brief says to deduct from "the bundle with the latest remaining quota", which is read
here as **the bundle with the most quota left**. Two refinements make that safe:

1. **Finite bundles drain before unlimited ones.** An Enterprise bundle has infinite
   remaining quota, so a naive "most remaining wins" comparison would always pick it and
   let every paid-for Basic/Pro response expire unused.
2. **Ties break on the earlier `endDate`**, spend what expires soonest first.

The rule is a pure function over loaded aggregates
(`src/subscriptions/domain/quota-selection.policy.ts`) with 12 unit tests covering it.

### Concurrency

Quota is money. The reserve step runs in a transaction taking `SELECT ... FOR UPDATE`
row locks on the free-quota row and the user's bundles, so two simultaneous requests
can never both spend the same last response. Counter writes are atomic `UPDATE`s
rather than `save(entity)`: a full-entity save writes every column from the snapshot
the caller read, which would let the billing job roll back a `messagesUsed` increment
a chat request committed in between.

The e2e suite proves it: fire **20 concurrent requests** at a user holding 3 free
messages and a 10-response Basic bundle, and exactly **13 return 201 and 7 return 402**.

### Reserve → call → persist

```
1. reserve quota   ── short transaction, row locks held
2. call the AI     ── slow (simulated latency), NO locks held
3. persist message ── question, answer, tokens, which allowance paid
   └─ on failure: refund the reservation, return 502 AI_PROVIDER_ERROR
```

Reserving *before* the provider call means a request can never get an answer it didn't
pay for; refunding on failure means it is never charged for an answer it didn't get. The
provider call sits outside the transaction because holding a row lock across a
multi-second network call would serialise every other request for that user.

---

## How billing works

A billing run does two things:

1. **Renew** every bundle whose `renewalDate` has arrived and has `autoRenew` on.
   - *Charge succeeds* → the period rolls forward from the previous `endDate` (so
     repeated renewals never drift off the anniversary date), `messagesUsed` resets to 0,
     `renewalCount` increments.
   - *Charge declines* → status becomes `INACTIVE`, the bundle stops serving immediately,
     the renewal date is cleared, and the reason is recorded on the bundle and in
     `payments`.
2. **Expire** bundles whose paid period has closed without renewing (including cancelled
   ones), status becomes `EXPIRED`.

Runs nightly on a cron, **and** on demand via `POST /billing/run` so a reviewer can watch
renewals and failures without waiting.

`PAYMENT_FAILURE_RATE` (default `0.2`) controls how often the simulated gateway declines.
Set it to `1` to make every renewal fail, or `0` to make them all succeed.

### Cancellation

Cancelling is deliberately *not* a deletion:

| Effect | Behaviour |
|--------|-----------|
| Ends the billing cycle | Status → `CANCELLED`; the bundle still serves until `endDate`, because the user paid for that period |
| Prevents renewal | `autoRenew` → false, `renewalDate` → null; the billing job skips it |
| Preserves history | `messagesUsed`, `chat_messages` and `payments` are untouched |

Once `endDate` passes, the expiry sweep moves it to `EXPIRED`.

---

## API reference

Base path `/api/v1`. Every endpoint except `/health` and `/users` requires an
`x-user-id` header.

### Chat

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Ask a question; returns the answer, token usage, and which allowance paid |
| `GET` | `/chat/history` | Paginated history, newest first (`?page=1&limit=20`) |
| `GET` | `/chat/usage` | Free-tier and per-bundle quota, plus month-to-date message and token totals |

### Subscriptions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/subscriptions/catalog` | Tiers, quotas and prices for both billing cycles |
| `POST` | `/subscriptions` | Purchase a bundle |
| `GET` | `/subscriptions` | List the caller's bundles (`{ items, total, returned }`) |
| `GET` | `/subscriptions/:id` | Fetch one bundle |
| `GET` | `/subscriptions/:id/payments` | Billing history, survives cancellation (`{ items, total, returned }`) |
| `PATCH` | `/subscriptions/:id/auto-renew` | Turn auto-renew on or off |
| `POST` | `/subscriptions/:id/cancel` | Cancel, ends the cycle, keeps history |

### Operations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/billing/run` | Run the billing cycle now (renew due bundles, expire lapsed ones) |
| `POST` | `/billing/reset-free-quota` | Roll stale free-message counters into the current month |
| `GET` | `/health` | Liveness plus a database round-trip |
| `GET` | `/users` | Seeded user ids, for the `x-user-id` header. Non-production only. |

Both `/billing` routes act on **every** account, not just the caller's, so they sit
behind `AdminGuard` rather than `CurrentUserGuard`. Set `ADMIN_API_KEY` and pass it as
`x-admin-key`; leave it unset and they stay open outside production, which is how the
walkthrough below drives them.

### Response envelope

Every response, success or failure, has the same shape:

```jsonc
{
  "success": true,
  "data": { /* ... */ },
  "error": null,
  "meta": { "timestamp": "2026-08-16T12:00:00.000Z", "path": "/api/v1/chat" }
}
```

Errors carry a stable machine-readable `code` and a structured `details` payload.
Clients branch on `code`, never on `message`:

```jsonc
{
  "success": false,
  "data": null,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Free monthly quota exhausted (3/3 used). Purchase a subscription bundle to continue.",
    "details": {
      "freeMessagesAllowance": 3,
      "freeMessagesUsed": 3,
      "freeMessagesRemaining": 0,
      "activeBundles": 0,
      "freeQuotaResetsAt": "2026-09-01T00:00:00.000Z"
    }
  },
  "meta": { "timestamp": "2026-08-16T12:00:00.000Z", "path": "/api/v1/chat" }
}
```

### Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHENTICATED` | 401 | Missing or unknown `x-user-id` |
| `VALIDATION_FAILED` | 400 | Request body or query failed validation; `details.violations` lists each one |
| `SUBSCRIPTION_ACCESS_DENIED` | 403 | The bundle belongs to another user |
| `ADMIN_ACCESS_DENIED` | 403 | An administrative endpoint was called without a valid key |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `RESOURCE_NOT_FOUND` / `SUBSCRIPTION_NOT_FOUND` | 404 | No such record |
| `QUOTA_EXCEEDED` | 402 | No free messages and no bundle able to serve |
| `INVALID_SUBSCRIPTION_STATE` | 409 | Illegal transition (e.g. cancelling twice) |
| `AI_PROVIDER_ERROR` | 502 | The provider failed; the reserved quota was refunded |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected, details are logged, never returned |

---

## Walkthrough (reproduce every rule in the brief)

```bash
API=http://localhost:3000/api/v1
ALICE=$(curl -s $API/users | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
H="content-type: application/json"

# 1. Free tier, three messages, with token accounting and simulated latency
curl -s -X POST $API/chat -H "x-user-id: $ALICE" -H "$H" \
  -d '{"question":"Explain database connection pooling."}'
#    → quotaSource FREE_TIER, quota.remainingAfter 2, usage.totalTokens > 0

curl -s -X POST $API/chat -H "x-user-id: $ALICE" -H "$H" -d '{"question":"again"}'
curl -s -X POST $API/chat -H "x-user-id: $ALICE" -H "$H" -d '{"question":"again"}'

# 2. Fourth message → structured 402
curl -s -X POST $API/chat -H "x-user-id: $ALICE" -H "$H" -d '{"question":"one more"}'
#    → QUOTA_EXCEEDED with the full details payload

# 3. Buy a Basic bundle, then ask again
SUB=$(curl -s -X POST $API/subscriptions -H "x-user-id: $ALICE" -H "$H" \
  -d '{"tier":"BASIC","billingCycle":"MONTHLY","autoRenew":true}')
curl -s -X POST $API/chat -H "x-user-id: $ALICE" -H "$H" -d '{"question":"now?"}'
#    → quotaSource SUBSCRIPTION, remainingAfter 9

# 4. Stack a Pro bundle, the next message comes out of Pro, not Basic
curl -s -X POST $API/subscriptions -H "x-user-id: $ALICE" -H "$H" \
  -d '{"tier":"PRO","billingCycle":"MONTHLY","autoRenew":true}'
curl -s -X POST $API/chat -H "x-user-id: $ALICE" -H "$H" -d '{"question":"which bundle?"}'
#    → charged to the Pro bundle (100 remaining beats 9), remainingAfter 99

# 5. See everything at once
curl -s $API/chat/usage -H "x-user-id: $ALICE"

# 6. Cancel, still usable until endDate, renewal disarmed, history intact
ID=$(echo $SUB | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
curl -s -X POST $API/subscriptions/$ID/cancel -H "x-user-id: $ALICE"
curl -s $API/subscriptions/$ID/payments -H "x-user-id: $ALICE"

# 7. Drive the billing simulation
curl -s -X POST $API/billing/run -H "x-user-id: $ALICE"

# 8. Free-quota reset job
curl -s -X POST $API/billing/reset-free-quota -H "x-user-id: $ALICE"
```

Time-dependent behaviour (a renewal date arriving, a month rolling over) is driven by the
injected `Clock`, so the **e2e suite** demonstrates it directly rather than asking you to
wait, see `test/subscriptions.e2e-spec.ts`.

---

## Testing

```bash
npm test            # 157 unit tests
npm run test:cov    # with coverage
npm run test:e2e    # 42 end-to-end tests against a real Postgres
```

| Suite | Count | Scope |
|-------|-------|-------|
| Unit | 157 | Domain policies, entities, application services, guards, filters, presenters, schedulers, config, all with mocked I/O |
| E2E | 42 | The real app over HTTP against a real database: the full request path through guards, pipes, transactions and repositories |

**Coverage: 93.4% statements, 91.6% branches, 93.6% lines** (threshold 80%).

Repositories are excluded from unit coverage, they are thin TypeORM query wrappers whose
behaviour (row locks, `ON CONFLICT`, pagination) is only meaningful against a real
database, which is exactly what the e2e suite exercises.

The e2e suite creates its own database (`ggi_assessment_e2e`), runs the migrations, and
replaces exactly two seams: a `FixedClock` the test moves, and a payment gateway the test
scripts per subscription. Everything else is production code.

Notable cases covered:

- three free messages then a structured 402, and the refill on the 1st
- the bundle-selection rule, including finite-before-unlimited and expiry tiebreaks
- two unlimited bundles compared head to head, where the remaining-quota
  subtraction is `Infinity - Infinity` and the comparator has to fall through
- cancellation still serving until `endDate`, then expiring
- a declined renewal marking a bundle inactive and stopping it serving
- an overlapping billing run finding the bundle no longer due, and skipping it
  rather than charging twice
- one bundle throwing mid-run without aborting the batch or the expiry sweep
- 20 concurrent requests against 13 available responses, exactly 13 served
- a refund arriving after the month rolled over, which must not be credited
  against the new month's allowance
- a provider failure refunding a bundle response against a real database, and
  the floor that stops an unmatched refund driving usage negative
- two concurrent billing runs charging one due bundle exactly once
- renewal dueness at the exact boundary instant, not a second past it
- month-boundary date arithmetic (Jan 31 + 1 month = Feb 28; leap years)

---

## Configuration

Everything is environment-driven; see `.env.example`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `API_PREFIX` | `api/v1` | Global route prefix |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | see `.env.example` | Postgres connection (matches `docker-compose.yml`) |
| `DB_POOL_SIZE` | `10` | Connection pool. Each chat request holds one for its quota transaction, so this bounds concurrency. |
| `FREE_MESSAGES_PER_MONTH` | `3` | Free monthly allowance |
| `MOCK_AI_MIN_DELAY_MS` / `MOCK_AI_MAX_DELAY_MS` | `300` / `1200` | Simulated provider latency window |
| `MOCK_AI_MODEL` | `gpt-4o-mini` | Model name reported on stored messages |
| `AI_TIMEOUT_MS` | `15000` | Ceiling on a completion, so a hung provider cannot strand reserved quota |
| `PAYMENT_FAILURE_RATE` | `0.2` | Probability a simulated renewal charge declines |
| `ADMIN_API_KEY` | _(unset)_ | Required by the two cross-tenant endpoints |
| `ALLOW_UNAUTHENTICATED_ADMIN` | `false` | Opens them with no key. Refused outright in production |
| `EXPOSE_SEED_USERS` | `false` | Whether `GET /users` is mounted |
| `DB_STATEMENT_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS` | `30000` / `10000` | Caps a statement and a lock wait, so a stalled provider cannot pin a row |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | `60000` / `60` | Rate-limit window and burst |
| `ENABLE_SCHEDULED_JOBS` | `true` | Turn cron off and drive billing purely via the endpoints |

`NODE_ENV` is validated against a fixed set at boot. Both security defaults used
to derive from it matching `'production'` exactly, which meant an unset or
misspelled value silently opened them, so they now fail closed and must be
opted into explicitly.

Config is parsed and **validated at boot**, a non-numeric `PORT` or a
`PAYMENT_FAILURE_RATE` outside `0..1` fails fast with a clear message rather than
producing `NaN` at runtime.

---

## Design decisions & assumptions

Points where the brief left room to interpret, and the call made:

1. **"Bundle with the latest remaining quota" = most quota left.** Finite bundles are
   drained before unlimited ones, otherwise an Enterprise bundle would always win and
   paid-for Basic/Pro responses would expire unused. Ties break on the earlier `endDate`.

2. **Quota is scoped to the billing period, not the calendar month.** A yearly Pro bundle
   grants 100 responses for the year and resets on renewal. This is the literal reading of
   "each subscription includes `maxMessages`". A per-month refill inside a yearly term
   would be a one-line change in `applyRenewal`.

3. **Random payment failure applies to renewals only.** The brief scopes it to auto-renew
   ("if payment fails (randomly), mark subscription inactive"), and keeping the initial
   purchase deterministic makes the API usable for setting up test scenarios. The initial
   charge is still recorded so billing history is complete.

4. **`x-user-id` instead of JWT auth.** The brief scopes this assessment to quota and
   billing; there is no auth requirement. The guard resolves the header to a real `User`
   row and everything downstream receives a verified aggregate, never a raw header string
, so swapping in JWTs means rewriting one file, `shared/auth/current-user.guard.ts`.

5. **Cancelled bundles keep serving until `endDate`.** "Ends current billing cycle" is
   read as ending the *renewal*, not confiscating the period already paid for.

6. **A declined renewal is not retried.** The bundle goes `INACTIVE` with the reason
   recorded. Dunning (retry schedules, grace periods) is real product surface well beyond
   the brief.

7. **Money is stored as integer cents** and exposed as both `priceCents` and a formatted
   `price` string. Floats are never used for money.

8. **Token counts are estimated** at ~4 characters per token, since the provider is
   mocked. A real client reports `usage` directly, which would replace the
   heuristic; it is flagged in the code so nobody mistakes it for a billing-grade
   number.

### Known limits

- **Renewal holds a row lock across the gateway call.** Bounded by
  `DB_LOCK_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` so a stalled provider cannot
  pin a row forever, but a real PSP still needs an idempotency key and an outbox:
  a crash between the charge returning and the commit rolls the payment row back
  and the next run charges again.
- **The tightening migration is written for an empty database.** Constraints are
  added without `NOT VALID` and indexes without `CONCURRENTLY`, so against a
  populated table it would hold `ACCESS EXCLUSIVE` locks for the whole run.
- **The cron is single-process.** Two instances would both fire, though the
  `SKIP LOCKED` claim and the dueness re-check inside the transaction mean that
  is safe rather than a double charge. A job queue is still the right answer at
  scale.
- **History pagination is `OFFSET`-based**, with `page` capped at 1000. Keyset
  pagination is the correct fix once a user's history gets long.
- **`GET /subscriptions` and `/subscriptions/:id/payments` cap at 100 rows.**
  They report `total` alongside `returned`, so a truncated list is visible, but
  there is no way to fetch page two yet.
- **Deleting a user cascades** to their subscriptions, payments and chat history.
  Retaining billing records past account deletion would need soft-deleted users.
- **Swagger is unauthenticated.** Convenient for review, would be gated in
  production.

---

## Project layout

```
src/
├── chat/                             Module 1, AI chat
│   ├── domain/                       ChatMessage, FreeQuota, typed errors
│   ├── application/                  ChatService, QuotaService, AiProvider port
│   ├── infrastructure/               Mock OpenAI client, repositories, reset cron
│   └── interface/                    Controllers, DTOs, presenter
│
├── subscriptions/                    Module 2, Subscription bundles
│   ├── domain/                       Subscription, Payment, tier catalog,
│   │                                 quota-selection policy, typed errors
│   ├── application/                  SubscriptionService, BillingService,
│   │                                 SubscriptionQuotaService, PaymentGateway port
│   ├── infrastructure/               Repositories, simulated gateway, billing cron
│   └── interface/                    Controllers, DTOs, presenter
│
├── users/                            Minimal user aggregate (identity only)
├── shared/
│   ├── auth/                         CurrentUserGuard + @CurrentUser decorator
│   ├── contracts/                    SubscriptionQuotaPort (cross-module boundary)
│   ├── domain/                       DomainError base + common errors
│   ├── http/                         Response envelope, exception filter
│   └── time/                         Clock port, UTC billing-period arithmetic
│
├── config/                           Validated env config, TypeORM data source
├── migrations/                       SQL schema migrations
├── health/                           Health check
├── seed.ts                           Demo data
└── main.ts                           Bootstrap: prefix, pipes, filter, Swagger

test/                                 E2E suite + helpers
docs/GGI-Backend-Test-Posture.pdf     The original brief
```

---

## Tech stack

TypeScript 5 · NestJS 11 · TypeORM 0.3 · PostgreSQL 16 · Jest + Supertest ·
ESLint 9 (flat config) + Prettier · Swagger / OpenAPI · Docker Compose
