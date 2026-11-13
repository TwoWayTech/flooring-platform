# ADR 0032: Notifications core and background jobs on pg-boss

- **Status:** accepted, 2026-11-13
- **Context:**
  - docs/real-build-plan.md, "Notifications core": events, rules, an Outbox worker on pg-boss, in-app notes;
  - spec docs/product-spec/notifications.md and ADR 0020;
  - CLAUDE.md's stack ("Jobs: pg-boss (later)");
  - the owner's retention decision of 2026-11-13: sign-in security data is kept 30 days.

  The owner was away and asked for the safest option on anything open.

## Decisions

### pg-boss 12.38.0 in the control database
- **The library:** pg-boss is named in CLAUDE.md's stack. The version is pinned exactly, about a month old when added. It uses the standard `pg` TCP driver and plain PostgreSQL in its own `pgboss` schema of the control database (rule 11), and it runs no install scripts.
- **One drizzle-orm copy:** its peer `@opentelemetry/api` is also declared in packages/db, so pnpm resolves one drizzle-orm copy for the whole workspace. Without it, apps/api and packages/db got different copies, and their types did not match.
- **Startup never blocks the API:** `JobsService` starts pg-boss in the background and retries every 5 seconds while the database is unreachable. The API always boots, and `/health` reports the outage.
- **Queueing and workers:** queue registration waits until pg-boss has started. Queueing waits at most 10 seconds, then fails, so a request never hangs. Every instance can queue jobs. Workers run where `JOBS_ENABLED` is true, polling every `JOBS_POLL_SECONDS`. Shutdown lets running jobs finish.
- **No deduplication by pg-boss:** queues use pg-boss's standard policy, which does not deduplicate jobs. A handler that must run once claims its work itself, as the Outbox worker does.
- **Retries:** each queue retries a failed job 3 times with backoff.

### Jobs reach company data through a job context
- A background job has no session. `TenantContext.forJob(company)` builds its context from the company's current access facts, the same facts TenantGuard checks, through `JobTenants.contextFor(companyId)`.
- A deleted company, or one whose database is not usable, gets no context, and the job does nothing for it.
- The context's user is `system:jobs`: it holds no permissions and is never a person.
- Lint lets only `core/jobs/job-tenants.ts` call `forJob`, as it does for `fromVerifiedSession`. Only the jobs code and the notification job handlers may import `JobTenants`, so no controller can turn a request's company id into a context (PR #9 review).
- The company id comes from the job's own data, which only our code queues.

### Raising an event
`NotificationService.notify(tenant, actorUserId, input)` follows the spec's "Raising an event":
1. It stops when the `settings.notifications` feature or the event's rule is off (`effectiveRule`: a stored rule, else the catalogue).
2. It skips the actor (rule 2).
3. It writes one Outbox row per new recipient. The dedupe key `event|source|version|kind|id` (rule 3) is the row's unique key and the provider's idempotency key.
4. Subject and body are rendered once and stored as snapshots, with the signature added (rules 7, 8). The values are company name, the input's values and the recipient's name.
5. A missing or malformed address makes the row `failed` and tells the actor in the app (rules 4, 5). A valid one is `queued`, or `scheduled` until `scheduledFor`, which pg-boss honours with `startAfter` (rule 13).
6. Rows are `restricted` when the caller or the catalogue says so (rule 6).
7. In-app notes go to everyone named except the actor.

### Sending
- The `outbox.send` worker first claims the row with one conditional update, `queued` or `scheduled` to `sending`, and sends only if it got the row (PR #9 review). So a second job, two Retry clicks, or a cancel during a send can never send a row twice or after it was cancelled.
- It sends through the EmailProvider (memory locally, Resend in production) and records `sent` with the provider's message id.
- **Headers:** the sender name is quoted and stripped of line breaks, quotes and angle brackets. The subject is on one line. An invalid reply-to is left out.
- **Read-only companies:** a suspended, cancelled or maintenance-mode company sends nothing. Its rows stay `queued`, and Retry (or the sweeper, STATUS) sends them once it is writable.
- **Stuck rows:** the provider call has a 30-second limit. Retry accepts a `failed` row, a `queued` row whose job is gone, and a row stuck in `sending` for over 10 minutes. The claim still allows one send, and the provider's idempotency key covers a send that did go out (PR #9 re-review).
- A provider failure records `failed` (`provider_error`) and tells the actor. It is not retried automatically: `POST /outbox/:id/retry` sends it again after checking the address.
- A row not yet visible makes the job retry, because its transaction has not committed.

### Endpoints
Each endpoint declares its permissions, and each answers 404 when its feature is off (rule 13).
- **`GET /notifications` and `POST /notifications/read`:** `@AnyCompanyMember`; the person's own notes only.
- **`GET /outbox`:**
  - `@AnyCompanyMember`;
  - the rows the person caused or received;
  - every row with `settings.outbox.view`;
  - someone else's restricted row is redacted without `hr.employee.view` (spec "Who can see").
- **`POST /outbox/:id/retry` and `/cancel`:** `settings.outbox.view`, the key that opens the Outbox page whose actions these are. The spec also lets people retry or cancel their own messages. This is stricter on purpose, until the Outbox screen moves to the API (recorded in the blueprint delta).
- **What `GET /outbox` returns:** only the screen's columns. Template values, the dedupe key and the provider's message id are never returned, so a redacted row cannot be read through them (PR #9 review). `POST /notifications/read` validates its `ids` with Zod.

### The 30-day cleanup
A daily `auth.cleanup` job (03:17 UTC) deletes:
- `auth_attempts` rows older than 30 days;
- `rate_limit` rows whose `last_request` is older than 30 days.

This applies the owner's retention decision (ADR 0029 part 2, docs/data-model.md).

## Left for later
- **Business events:** quotes, invoices, payments, time off and the rest raise their events when their modules move to the API.
- **Not built yet:** the settings screens for rules and sender, saving rules (with `unknownTokens`), the bounce webhook (`bounced`), attachments (PDF and .ics through StorageProvider) and the "Needs attention" checks.
- **Auditing Outbox status changes:** the Outbox is its own record of sends. Retry and cancel are audited by the request pipeline's safety net.

## Rejected
- **A separate job database or a Redis queue:** another service to run. pg-boss keeps jobs in the database we already have.
- **Sending inside the request:** a slow or failing provider would slow or fail the user's action. The Outbox row is written first and sent in the background.
- **Automatic provider retries:** the owner decides what is sent again; a failed row waits for Retry.
