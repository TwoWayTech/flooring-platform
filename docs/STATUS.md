# Status: real build

- **Phase:** week 1 of docs/real-build-plan.md. The demo is finished, on branch `demo` (tag `demo-v3`), and its status is in docs/archive/demo-STATUS.md.
- **In progress:** `feat/auth-better-auth`, P8 part 1 (Better Auth sign-in). It is built, tested and security-reviewed, and the one finding is fixed in `22f330a`. PR #2 is ready, all CI checks are green, and it waits for B's review and merge.
- **Last session log:** docs/sessions/2026-11-12-1337-a-auth-security-review.md

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
- [x] P8 part 1, on `feat/auth-better-auth` (not merged yet; ADR 0029):
  - Better Auth email and password: invite-only, 12-character minimum, verification email through EmailProvider.
  - The auth tables have UUID ids, with UUID v7 made by the API (migration 0001). `organization.id` references `tenants.id`.
  - Per-company idle and absolute timeouts, enforced by the API.
  - Company pick by host, single company or chooser.
  - `GET /auth/context`.
  - The real login page in api mode, proxied through the web host.
  - `pnpm db:seed` sets seed passwords from `SEED_USER_PASSWORD`.
  - The api-mode Playwright project runs in CI `verify`.

## Next three tasks
1. **A:**
   - B reviews and squash-merges PR #2, "P8 part 1". The `/security-review` is done and its finding is fixed.
   - Then do P8 part 2 on `feat/auth-mfa`: TOTP with backup codes, passkeys, mandatory MFA for Owner, Accountant, HR and platform admins, rate limits and lockout, and `GET /public/branding?host=`.
2. **B:**
   - Add the `/feature` and `/review` commands, the security-reviewer, test-writer and schema-reviewer subagents, and the Stop hook (blueprint p35, p41), on `feat/tooling-claude-agents`.
3. **B (week 2):** in api mode, build the real MFA enrolment and code screens, plus the Playwright auth tests, on top of P8 part 2.

## Blockers and open questions
- **Temp file with a throwaway password:** `C:\Users\Admin\AppData\Local\scratch-e2e`, which holds the file `pw`. Claude's delete was denied, so delete it by hand.
- **Open questions in docs/real-build-plan.md:** brand name and domain, legal entity, hours per week, the accountant's decisions, plan prices.
- **Lockout thresholds:** the blueprint asks for lockout after repeated failures but gives no numbers. The owner decides them in P8 part 2.
- **Password reset and invitation acceptance:** the blueprint names the routes (p31), but no spec exists yet.
- **`.env.example`:** it could not be written, because Claude Code is denied `.env.*` files. docs/environment.md lists the variables instead. Create `.env` or `.env.local` at the repo root by hand; it now also needs `BETTER_AUTH_SECRET` and `SEED_USER_PASSWORD`.
