# ADR 0033: Company life cycle and maintenance mode

- **Status:** accepted, 2026-11-13
- **Context:** the owner's decisions of 2026-11-13 on questions left open by P9 and P10 (PR #8 reviews). Until now, an `active` or `past_due` subscription gave access with no end. A trial company that was suspended or cancelled before subscribing could read nothing. A company whose migration failed kept serving reads from an old schema if its database was read-only.

## Decision

### Life cycle
`companyPhase()` in packages/shared works out `full`, `read_only` or `locked` from three facts: the company's status, `tenants.status_changed_at`, and every subscription row, deleted rows included. TenantDirectory works out the phase again on every request and every job.

| Case | Full | Then read-only | Then locked |
| --- | --- | --- | --- |
| Paid plan (`active`, `past_due`) past its period end | 14 days | 30 days | yes |
| Trial subscription past its end, never paid | until the end | 30 days | yes |
| Company `suspended` or `cancelled` that never paid | none | 30 days from the status change | yes |
| Company `cancelled` after paying | none | 90 days from the status change (blueprint p29) | yes |
| Company `suspended` after paying | none | until a platform admin acts (p40) | only when its plan lapses |
| Fresh trial with no subscription rows | always (plan prices are still open) | | |

- **Subscriptions:** each live subscription gets its own phase, and the most generous one counts. The company's status can then only make the result stricter.
- **What "paid" means:** a subscription row is paid when it is `active` or `past_due`, or `cancelled` with a price above zero. This depends on trial rows carrying price `0`; the billing webhook must keep it so, or record payment in its own column (STATUS, PR #10 review).
- **Deleted rows:** when every subscription row is deleted, the deleted rows still run their own ladder, so deleting a lapsed row never restores access. Only a company with no rows at all counts as a fresh trial (PR #10 review).
- **Locked:**
  - sign-in and `GET /auth/context` still work;
  - every company route answers 403 `company_suspended`;
  - jobs skip the company.
- **No deletion:** nothing is ever deleted automatically. Paying, or a platform admin changing the status, restores access at once.
- **`status_changed_at`:** the control trigger `tenants_status_changed` (migration 0003) stamps it on every real status change, whoever writes it, and puts back the old value on any other write, so no update can move the periods (PR #10 review). Tests move it with `backdateStatusChange` in `@workspace/db/testing`, which switches the trigger off for one update. Existing companies start their periods at the migration, which is the most generous choice.

### Maintenance mode
- **What it blocks:** maintenance mode now stops reads as well as writes. It answers 503 `company_maintenance` with "Your company's account is under maintenance."
- **Why it is on:** `tenants.maintenance_reason` records the cause, `migration_failed` or `move`. Only migrate-all writes it today; `move-tenant` (not built yet, STATUS) must set `move` when it turns maintenance on. A reason left empty is never cleared by a migration.
- **Error text:** the error is capped at 500 characters before it goes into `last_error`, the audit row and the email.
- **When a migration fails, migrate-all:**
  - turns maintenance on;
  - writes `company.migration_failed` to `platform_audit_log`;
  - calls `onFailure`, where `pnpm db:migrate` emails every active platform admin through EmailProvider, one email each. The email gives the error code only, because the full text can name a database host or user; that text stays in `last_error` and the audit row;
  - stops.
- **When the migration later succeeds:** maintenance ends only if the reason was `migration_failed`, and `company.migration_recovered` is logged. A move keeps its own maintenance.
- **Jobs:** they skip a company in maintenance. A job that was already running when maintenance turned on finishes its current work; maintenance stops new requests and new jobs at once, not ones in flight (PR #10 re-review).
- **Merging (`.claude/settings.json` and `.claude/hooks/merge-push-guard.mjs`):** wildcard rules cannot say "only these arguments", so a PreToolUse hook reads every Bash command, wrappers such as `pnpm exec`, `npx` and `node -e` included. It splits the command at `;`, `&&`, `||`, `|` and line breaks and blocks: any `gh pr merge` that is not exactly `gh pr merge <n> --squash [--match-head-commit <sha>] [--delete-branch]`; any `gh api` call that is not a plain read (another method, fields, input or GraphQL) and `gh repo edit`; any `git … push` (global options such as `-C` included) that names `main`, pushes HEAD or the current branch while on main, or forces, mirrors, prunes or deletes; and `git config` writes that steer pushes. A tool call it cannot read is refused (fail closed). Hooks run in every permission mode. Because it matches words anywhere, it also blocks a command that only mentions them in text (write such text with a file instead). The permission rules stay as a second layer: the only merge allowed without a person's approval is `gh pr merge <n> --squash`, optionally followed by `--delete-branch` or `--match-head-commit <sha> --delete-branch`. `--squash=…`, `--merge` and `--rebase` (with or without `=`), `-m` and `--admin` are denied, so no flag combination turns the squash into another method (PR #10 security reviews). GitHub itself still allows merge commits and rebase merges; switching them off is an owner setting (STATUS).

## Consequences
- **Cost:** each request makes one extra control-database query for the subscription rows.
- **Alert email:** it needs `EMAIL_PROVIDER=resend` and `EMAIL_FROM` wherever `pnpm db:migrate` runs. With the memory adapter the alert is only logged. The audit row is always written.
- **Web:** the web app shows the API's message as it does for other refusals. A dedicated "under maintenance" and "suspended" screen comes with the platform-admin screens.
