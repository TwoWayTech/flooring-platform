# 2026-11-13, Person A: owner decisions and fixes

## Goal
Owner's second work queue (2026-11-13), task 1: build the owner's decisions on the open questions, narrow the rebase deny in `.claude/settings.json`, and make notification Retry respect a message's scheduled time. The owner is away, so there are no stops for questions. The safest option for anything open goes in docs/blueprint-delta.md.

## Prompt used
The owner's work queue of 2026-11-13 (second), task 1, with the owner's decisions:
- **Required check:** GitHub Free cannot enforce it on a private repo. Keep the self-merge rule, and add the item to STATUS for a paid plan.
- **Plan prices:** still open. New companies stay on trial, and prices stay data, not code.
- **Lapsed paid plan:** full access for 14 days after expiry, then read-only for 30 days, then suspended. Never delete data automatically.
- **Trial suspended or cancelled before subscribing:** read-only for 30 days so the company can export, then suspended.
- **Failed migration:** no reads on an old schema. Maintenance mode (a clear "under maintenance" message, no reads or writes), an alert to platform admins, and a log entry.

## Plan
1. **packages/shared:** `companyPhase()`, a pure rule giving `full`, `read_only` or `locked` from the company's status, when it last changed, and its subscriptions, with unit tests for every boundary.
   - **Paid plan (`active` or `past_due`):** full until 14 days after the latest period end, read-only for 30 days more, then locked.
   - **Trial that never paid, suspended, cancelled or expired:** read-only for 30 days from the change or the trial's end, then locked.
   - **Cancelled after paying:** read-only for 90 days (blueprint p29), then locked.
   - **Suspended after paying:** read-only (blueprint p40) until a platform admin acts.
   - **Locked:** sign-in and `/auth/context` still work, and every company route answers 403 `company_suspended`. No data is deleted.
2. **Control schema:**
   - `tenants.status_changed_at`, set by a trigger whenever the status changes, so no writer can forget it;
   - `tenants.maintenance_reason` (`migration_failed` or `move`).
   Migration 0003.
3. **API:**
   - TenantDirectory reads subscriptions and gives the phase.
   - TenantGuard: maintenance → 503 `company_maintenance` for reads and writes; locked → 403 `company_suspended`; read-only phase → `company_read_only` on writes.
   - Jobs skip maintenance and locked companies.
4. **migrate-all:** a failed company gets maintenance mode with reason `migration_failed`, whether it was read-only or not, and a `platform_audit_log` row (`company.migration_failed`).
   - The CLI emails every active platform admin through EmailProvider and exits non-zero.
   - A later successful migration clears maintenance only when the reason was `migration_failed`, and logs `company.migration_recovered`.
5. **Notifications:** Retry of a row whose `scheduledFor` is in the future queues the job for that time (`startAfter`), not now.
6. **`.claude/settings.json`:** drop the `gh pr merge * -r*` deny. `--rebase` stays denied.
7. **Docs and tests:** ADR 0030 and 0031 notes, the API contract, data-model, blueprint delta, STATUS (the required check waits for a paid GitHub plan); isolation, migrate and notifications tests.
