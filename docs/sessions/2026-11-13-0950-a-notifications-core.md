# 2026-11-13, Person A: notifications core

## Goal
Owner's work queue, task 3: "Notifications core from docs/real-build-plan.md: the EmailProvider and the outbox worker on pg-boss, with memory email locally." It also covers the 30-day cleanup job of `auth_attempts` and `rate_limit` that the owner decided on 2026-11-13 (STATUS). The owner is away, so there are no stops for questions. The safest option goes in docs/blueprint-delta.md.

## Prompt used
The owner's work queue, 2026-11-13, task 3. Spec: docs/product-spec/notifications.md, business rules 1–13, and ADR 0020.

## Plan
1. **Dependency:** `pg-boss` in apps/api. CLAUDE.md's stack already names it ("Jobs: pg-boss (later)"), and it is recorded in ADR 0032. It uses its own `pgboss` schema in the control database, over the standard `pg` TCP driver, so it stays plain PostgreSQL (rule 11).
2. **apps/api core/jobs:**
   - `JobsModule` starts pg-boss with the app and stops it at shutdown. `JOBS_ENABLED` turns the workers off where an instance should only enqueue.
   - `JobContext`: background jobs reach a company database through `TenantContext.forJob(company)`. Only the job runner may call it (lint, like `fromVerifiedSession`). It is built from the company's current access facts, so deleted, unusable or read-only companies are handled exactly as TenantGuard would handle them.
3. **apps/api core/notifications:**
   - `NotificationService.notify(tenant, actorUserId, input)`, following the spec's "Raising an event":
     - the feature switch;
     - `effectiveRule` from the stored rule or the catalogue;
     - the actor is skipped;
     - `dedupeKey`;
     - rendered snapshots (subject, body with signature, values);
     - address check (`missing_email`, `invalid_email`);
     - restricted rows;
     - in-app rows.

     Valid rows are `queued` (or `scheduled`). Each gets an `outbox.send` job, with the `dedupeKey` as pg-boss singleton key and as the provider idempotency key.
   - **The worker:** it loads the row, sends through EmailProvider, and records `sent` (with `providerMessageId`) or `failed` (`provider_error`, which tells the actor in-app, spec rule 5). A scheduled row's job starts after `scheduledFor`.
   - **Endpoints, each declaring its permissions:**
     - `GET /notifications` and `POST /notifications/read` (`@AnyCompanyMember`, the person's own rows);
     - `GET /outbox` (the person's own rows, all rows with `settings.outbox.view`, restricted rows redacted without `hr.employee.view`, spec "Who can see");
     - `POST /outbox/:id/retry` and `POST /outbox/:id/cancel` (`settings.outbox.view`).
4. **The 30-day cleanup:** a daily `auth.cleanup` job deletes `auth_attempts` older than 30 days and `rate_limit` rows whose `last_request` is older than 30 days. This is the owner's retention decision.
5. **Tests:**
   - integration tests with pg-boss on a throwaway control database: notify, queue, send through the memory email, dedupe, a bad address, a scheduled row, a provider failure, retry, cancel, in-app list and read, outbox visibility and redaction, and the cleanup;
   - unit tests for the address check and the redaction.
6. **Docs:** ADR 0032, the API contract, environment (`JOBS_ENABLED`), the blueprint delta, STATUS and BRANCHES.

## What was built
- **packages/shared:** the `sending` Outbox status, with its label in apps/web.
- **packages/db:** `@opentelemetry/api`, pg-boss's peer, declared so the workspace keeps one drizzle-orm copy.
- **apps/api, core/jobs:**
  - `JobsService`: pg-boss 12.38.0 in the `pgboss` schema, background start with retries, a 10-second queueing limit, graceful stop;
  - `JobTenants`;
  - `JobsModule`.
- **apps/api, core/notifications:**
  - `NotificationService`: notify, the claimed send worker, retry, cancel, Outbox and in-app reads, the 30-day cleanup;
  - `notification-rules`: the address check, dedupe key, failure notice, visibility and redaction, header sanitising;
  - the two controllers;
  - the module.
- **apps/api, elsewhere:** `TenantContext.forJob`, and lint confining `forJob` and `JobTenants`. The env gains `JOBS_ENABLED` and `JOBS_POLL_SECONDS`.
- **Tests:**
  - `notifications.int.test.ts`, 15 tests: send, dedupe, actor skipped, bad address, provider failure and retry, scheduled and cancel, visibility and redaction with no leaking fields, 403s, cleanup, in-app, catalogue restriction, double Retry, read-only, own-notes only, two jobs for one row, cancel before release;
  - `notification-rules.test.ts`.
- **Docs:** ADR 0032, the API contract, environment, data-model retention, ADR 0029, the blueprint delta and STATUS.

## Reviews
- **First security review:** 4 blocking findings, all fixed in `ee2cc74`:
  - redaction leaked through `values`;
  - double or cancelled sends;
  - catalogue restriction was ignored;
  - jobs ignored read-only companies.
- **Re-review:** 1 blocking finding. The tests could not see a second send. Fixed in `e68f714`; a mutation check proves the claim.
- **Third review:** 0 blocking. Its findings are in STATUS.

## Commands run and results
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: pass.
- `pnpm test`: all packages pass.
- `pnpm test:api`: api 125, db 17, providers 2.

## What is left
STATUS, "Notifications follow-ups":
- Retry should respect `scheduledFor`;
- the claim should skip soft-deleted rows;
- confine queueing sends with lint;
- stop pg-boss when shutdown comes mid-start;
- tests for the stale-`sending` Retry, the provider timeout, Retry after read-only, and own-row SQL filter cases;
- a sweeper;
- sender settings with Zod;
- bounces;
- attachments;
- business events;
- check Resend's replay behaviour with the first staging send.

## Next prompt
"/resume. The work queue of 2026-11-13 is done. Next: the owner's decisions in STATUS, then P10 part 2 (Settings → Users and Roles API) or the next module in docs/real-build-plan.md."
