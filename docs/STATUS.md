# Status: real build

- **Phase:** week 1 of docs/real-build-plan.md. The demo is finished, on branch `demo` (tag `demo-v3`), and its status is in docs/archive/demo-STATUS.md.
- **In progress:** `feat/tenancy-company-databases`, P9, PR #6. The work queue continues with P10, then the notifications core.
- **Reviews and merges on 2026-11-13:** A did B's reviews and merges that day, because B's internet was down.
  - A squash-merged PR #2 (P8 part 1, `31e2297`) and PR #3 (Claude tooling, `ab57891`).
  - From that day Claude self-merges under the CLAUDE.md rule (owner decision; docs/blueprint-delta.md): PR #4 (`0ec9f6c`) and PR #5 (`1c47288`).
- **Last session log:** docs/sessions/2026-11-13-0700-a-tenancy-company-databases.md

## Done
- [x] Branch `demo` created from tag `demo-v3` and pushed. Vercel is connected to the repository and production deploys from `demo` (first Git deploy `2026f30`, 2026-11-12); details in docs/deploy.md, "Demo branch".
- [x] apps/api: NestJS 12, `GET /health` (control-database ping, 503 when down), config validated at start-up, OpenAPI at `/docs` and `/docs/openapi.json`, one error body, CORS, Dockerfile (image builds and reports healthy).
- [x] packages/db:
  - control schema (26 tables, Better Auth included) and company schema (84 tables), both mapped from docs/data-model.md;
  - migrations and migrate-all;
  - AES-256-GCM connection strings;
  - the Summit Floor Co. foundation seed (idempotent);
  - the table-rules test.
- [x] packages/providers: Neon and plain-Postgres provisioners, S3/R2 storage, Resend email, and no-op and memory adapters, chosen from env.
- [x] docker-compose.yml with PostgreSQL 16.
- [x] CI:
  - `fast` on branch pushes;
  - `verify` (Postgres, API tests, web build, smoke) on ready PRs to main and pushes to main;
  - the full browser suite on ready PRs;
  - `merge-log.yml`.
- [x] Handoff system:
  - /resume and /handoff;
  - docs/BRANCHES.md and docs/MERGE_LOG.md;
  - the PR template;
  - deny rules for pushing or merging to main;
  - CLAUDE.md rewritten.
- [x] apps/web: `NEXT_PUBLIC_DATA_SOURCE=api` routes the methods in `API_METHODS` to apps/api. The persona picker shows in demo mode only, and `/api/demo/*` answers 404 in api mode.
- [x] docs/real-build-plan.md: module order, spec-to-prompt map, 20 weeks for A and B, CI budget.
- [x] P8 part 1, merged to main in PR #2 (`31e2297`, ADR 0029):
  - Better Auth email and password: invite-only, 12-character minimum, verification email through EmailProvider.
  - The auth tables have UUID ids, with UUID v7 made by the API (migration 0001). `organization.id` references `tenants.id`.
  - Per-company idle and absolute timeouts, enforced by the API.
  - Company pick by host, single company or chooser.
  - `GET /auth/context`.
  - The real login page in api mode, proxied through the web host.
  - `pnpm db:seed` sets seed passwords from `SEED_USER_PASSWORD`.
  - The api-mode Playwright project runs in CI `verify`.
- [x] Claude tooling (blueprint p35, p41), merged to main in PR #3 (`ab57891`). This was task "c"; A took it over from B on 2026-11-12, and A merged it on 2026-11-13.
  - Commands: `/feature` (spec → plan → tests → code → checks → summary) and `/review` (pre-PR self-review against CLAUDE.md).
  - Subagents in `.claude/agents`: security-reviewer on opus; test-writer and schema-reviewer on sonnet.
  - Stop hook `.claude/hooks/handoff-reminder.mjs`. It is non-blocking and reminds you to `/handoff` when the tree is dirty or today's session log is missing. Its tests run as `pnpm test:hooks`, which is part of `pnpm test`.
  - Not built yet: the p41 PostToolUse hook that runs lint and typecheck after edits. Only the Stop hook was asked for.
- [x] P8 part 2, merged to main in PR #4 (`0ec9f6c`, ADR 0029 part 2), with the lockout refinements in PR #5 (`1c47288`):
  - TOTP and 10 backup codes, passkeys with user verification, mandatory MFA for Owner, Accountant, HR and platform admins;
  - the password lockout (5 in 15 minutes, 15-minute lock), per-IP limits through the web proxy's `AUTH_PROXY_SECRET`, and 3 verification emails an hour;
  - `GET /public/branding?host=`;
  - Claude's self-merge rule.
- [x] P9 on `feat/tenancy-company-databases` (PR #6, ADR 0030; not merged at the time of writing):
  - `pnpm db:provision-tenant`;
  - TenantConnectionService through a session-only TenantContext;
  - global deny-by-default session and tenant guards;
  - the company-isolation suite.

## Next three tasks
The work queue the owner set on 2026-11-13. Claude runs it in order, each task on its own branch from an up-to-date main, and self-merges under the CLAUDE.md rule.
1. **Owner:** make the CI `verify` check (it runs the isolation suite) required in GitHub branch protection for `main` (blueprint P9).
2. **A (Claude):** P10 (R4): permissions in the API reusing the engine in packages/shared, deny-by-default guards, the audit log and approvals.
3. **A (Claude):** the notifications core: EmailProvider and the outbox worker on pg-boss, with memory email locally. Include the 30-day cleanup job (Follow-ups).

Also open for B (week 2): the passkey screens and QR code. They must call `/verify-password` before registration (docs/api-contract.md).

## Follow-ups (don't forget)
- **30-day cleanup job (owner decision, 2026-11-13):** a daily pg-boss job deletes `auth_attempts` rows older than 30 days (`created_at`) and `rate_limit` rows older than 30 days (`last_request`). Build it in the notifications core task, which brings pg-boss. Until then nothing prunes these tables (docs/data-model.md, "Retention of sign-in security data").
- **Reset email limit:** when password reset gets a spec (with Settings → Users), apply the same limit as verification emails, 3 an hour per address, through `AttemptLog.reserveEmail` (ADR 0029, part 2).
- **MFA by role content, not key (before role management, P10):** a role copied from Accountant or HR gets a new key, so it would not require MFA. Decide from what the role can do (a `requiresMfa` rule in packages/shared), and keep `member.role` in sync whenever roles are assigned (PR #4 security review, finding 7).
- **Rate limit on `GET /public/branding`:** 200 versus 404 lets anyone list company slugs and display names. Add a per-IP limit (PR #4 security review, finding 9).
- **P10: deny company routes that declare no product.** A route without `@RequireProduct()` serves any company; add this to the route-inventory test (PR #6 review, finding 5).
- **CREATE ROLE password in DDL logs:** `PostgresServerProvisioner` sends the role password in plain text, so a server with `log_statement=ddl` logs it. Send a SCRAM verifier made on the client instead (PR #6 review, finding 6).
- **Orphaned role on a crash:** if provisioning dies between CREATE ROLE and the `tenant_databases` insert, retries fail on CREATE ROLE. This fails closed; clean it up by hand, or make the provisioner reuse or reset the role (PR #6 review).
- **move-tenant:** maintenance mode, pg_dump/pg_restore, checksums, the connection swap, and `TenantConnectionService.invalidate(companyId)` (ADR 0030).

## Blockers and open questions
- **Open questions in docs/real-build-plan.md:** brand name and domain, legal entity, hours per week, the accountant's decisions, plan prices.
- **Password reset and invitation acceptance:** the blueprint names the routes (p31), but no spec exists yet. They come later with Settings → Users.
- **Before production:** set `AUTH_PROXY_SECRET` (api and web, the same value), `PASSKEY_RP_ID` and exact `AUTH_ALLOWED_HOSTS`. The API refuses to start in production without them (docs/environment.md).
- **`.env.example`:** Claude Code is denied `.env.*` files, so docs/environment.md lists the variables instead. The owner's `.env.local` exists with `BETTER_AUTH_SECRET` and `SEED_USER_PASSWORD`, so this is not a blocker.
