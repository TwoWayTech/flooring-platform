# Status: real build

- **Phase:** base (week 1 of docs/real-build-plan.md). The demo is finished, on branch `demo` (tag `demo-v3`), and its status is in docs/archive/demo-STATUS.md.
- **In progress:** `feat/platform-base`, a draft PR to main, waiting for the other person's review.
- **Last session log:** docs/sessions/2026-11-12-1200-a-platform-base.md

## Done
- [x] Branch `demo` created from tag `demo-v3` and pushed. The Vercel setting is in docs/deploy.md, "Demo branch".
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

## Next three tasks
1. **B:** review and merge the `feat/platform-base` PR. Mark it ready for review first so `verify` and `e2e` run, then squash-merge, and check that merge-log appends a line.
2. **A:** P8 part 1 on `feat/auth-better-auth`. Prompt: "/resume, then run blueprint prompt P8 (docs/real-build-plan.md week 1-2): Better Auth email and password with verification, session cookie and timeout rules, organization plugin with organization id = tenant id, user ids as UUIDs; regenerate packages/db/src/control/auth.ts with @better-auth/cli; plan mode first."
3. **B:** add the `/feature` and `/review` commands, the security-reviewer, test-writer and schema-reviewer subagents, and the Stop hook (blueprint p35, p41), on `feat/tooling-claude-agents`.

## Blockers and open questions
- The owner must connect the GitHub repository to Vercel and set Production Branch Tracking to `demo` (docs/deploy.md). Until then the demo deploys by hand.
- The open questions in docs/real-build-plan.md: brand name and domain, legal entity, hours per week, the accountant's decisions, plan prices.
- `.env.example` could not be written, because Claude Code is denied `.env.*` files. docs/environment.md lists the variables instead; create `.env` by hand if you want local values.
