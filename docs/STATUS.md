# Status: real build

- **Phase:** week 1 of docs/real-build-plan.md. The demo is finished, on branch `demo` (tag `demo-v3`), and its status is in docs/archive/demo-STATUS.md.
- **In progress:** PR #3, `feat/tooling-claude-agents`: task "c", the Claude tooling. **A took it over from B.** It is ready, rebased onto main after PR #2 merged, and waits for B's review and merge.
- **Last session log:** docs/sessions/2026-11-12-1531-a-tooling-claude-agents.md

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
- [x] Claude tooling (blueprint p35, p41), on `feat/tooling-claude-agents` (PR #3, not merged yet). This was task "c"; A took it over from B on 2026-11-12.
  - Commands: `/feature` (spec → plan → tests → code → checks → summary) and `/review` (pre-PR self-review against CLAUDE.md).
  - Subagents in `.claude/agents`: security-reviewer on opus; test-writer and schema-reviewer on sonnet.
  - Stop hook `.claude/hooks/handoff-reminder.mjs`. It is non-blocking and reminds you to `/handoff` when the tree is dirty or today's session log is missing. Its tests run as `pnpm test:hooks`, which is part of `pnpm test`.
  - Not built yet: the p41 PostToolUse hook that runs lint and typecheck after edits. Only the Stop hook was asked for.

## Next three tasks
1. **B:** review and squash-merge PR #3, the Claude tooling. It is rebased onto main, so it no longer conflicts. Check that merge-log appends a line for it.
2. **A:** P8 part 2 on `feat/auth-mfa` (already created from main) with `/feature`:
   - TOTP with backup codes;
   - passkeys;
   - mandatory MFA for Owner, Accountant, HR and platform admins;
   - rate limits and lockout;
   - `GET /public/branding?host=`.
3. **B (week 2):** in api mode, build the real MFA enrolment and code screens, plus the Playwright auth tests, on top of P8 part 2.

## Blockers and open questions
- **Open questions in docs/real-build-plan.md:** brand name and domain, legal entity, hours per week, the accountant's decisions, plan prices.
- **Lockout thresholds:** the blueprint asks for lockout after repeated failures but gives no numbers. The owner decides them in P8 part 2.
- **Password reset and invitation acceptance:** the blueprint names the routes (p31), but no spec exists yet.
- **`.env.example`:** it could not be written, because Claude Code is denied `.env.*` files. docs/environment.md lists the variables instead. Create `.env` or `.env.local` at the repo root by hand; it now also needs `BETTER_AUTH_SECRET` and `SEED_USER_PASSWORD`.
