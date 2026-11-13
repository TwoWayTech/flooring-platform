# 2026-11-13, Person A: P9 company provisioning and isolation

## Goal
Blueprint P9 (R3), as narrowed by the owner's work queue:
- the company setup script;
- one database per company;
- TenantConnectionService;
- isolation tests proving one company can never read another's data.

Local Postgres provider only. The owner is away and asked for the safest option on anything open, recorded in docs/blueprint-delta.md, and for no stops to ask.

## Prompt used
The owner's work queue, 2026-11-13, task 1: "Blueprint P9 (R3): company setup script, one database per company, TenantConnectionService, and isolation tests proving one company can never read another's data. Local Postgres provider only." Follow .claude/commands/feature.md, without plan mode; the plan is written here.

## Plan
1. **packages/shared:** the products' default branding moves from apps/web into `PRODUCT_DEFAULT_BRANDING`, so provisioning and the login page share it.
2. **packages/db:** `provisionTenant`, with the CLI `pnpm db:provision-tenant`:
   - It checks the slug: a-z and 0-9, 2–31 characters, starting with a letter, not on the reserved list.
   - It writes the control rows in one transaction: `tenants` (status `trial`), `organization` (same id), `tenant_products`, the default `tenant_branding`, the owner `user` (unverified, with no password) and `member` (role key `owner`).
   - It then creates the company's own database through DatabaseProvisioner and migrates it (`provisionCompany`).
   - A run that failed after the control rows resumes when started again with the same slug.
3. **apps/api, core/tenancy:**
   - **`TenantContext`:** a branded value that only TenantGuard can create from the verified session. It holds the company id, its products and whether it is read-only.
   - **`TenantConnectionService.db(context)`:** the only way to reach a company database.
     - It looks up `tenant_databases`, ready or read-only, for a company that is not deleted.
     - It decrypts the URL and opens a small pool.
     - It keeps an LRU cache of pools (`TENANT_POOL_CACHE`, default 20) and closes evicted pools and all pools at shutdown. No new dependency.
   - **Global guards, deny by default:** SessionGuard, then TenantGuard. `@Public()` skips both; `@SessionOnly()` skips the tenant check.
     - TenantGuard refuses a session with no open company (403 `company_required`).
     - It refuses a host product the company does not have (403 `product_not_enabled`).
     - It refuses writes for suspended or cancelled companies and those in maintenance (403 `company_read_only`). Blueprint p29 and about p40: they may still sign in and view.
     - `@RequireProduct()` is ready for modules.
4. **Isolation tests:**
   - Two companies are provisioned with real separate databases on the docker server.
   - A test-only probe controller uses TenantConnectionService for list, get, create, update and delete on `branches`.
   - Signed in to A, every pattern against B fails: B's ids in the path, `companyId` in the query, body and headers, and switching to B without membership. B's rows stay unchanged.
   - A route-inventory test refuses every non-public route without a session.
   - All of this runs in `pnpm test:api`, which is in CI `verify`.
5. **Docs:**
   - ADR 0030 (tenancy).
   - docs/api-contract.md: the new codes and decorators.
   - docs/environment.md: `TENANT_POOL_CACHE`.
   - docs/blueprint-delta.md: the deferrals.
   - STATUS and BRANCHES.

## Deferred (safest option, recorded in the blueprint delta)
- **`move-tenant`** (maintenance mode, pg_dump/pg_restore, checksums, connection swap): it needs a second provider and the pg_dump binaries, and the owner limited this task to the local Postgres provider.
- **Making the isolation suite a *required* GitHub check:** it is a branch-protection setting, so the owner does it. The suite runs in `verify`.
- **Company defaults in a new database (default roles, settings, sequences):** these arrive with P10 roles and the onboarding work. Until then a new company is denied by default: an empty permission ceiling and no roles.
- **Owner sign-in for a new company:** the owner user has no password until invitation acceptance has a spec.
- **Plans and subscriptions:** a new company is `trial` with no subscription row, because plan prices are an open owner decision.

## What was built
- **packages/shared:** `PRODUCT_DEFAULT_BRANDING` and `PRODUCT_HEADER` (apps/web re-exports them).
- **packages/db:** `provisionTenant`, `slugProblem` and `RESERVED_SLUGS` in `src/provision-tenant.ts`, with the CLI `scripts/provision-tenant.ts` (`pnpm db:provision-tenant`) and `--reuse-owner`. `ensureReferenceData` is now exported from the seed.
- **apps/api, core/tenancy:**
  - `access.ts`: `@Public()`, `@SessionOnly()` and `@RequireProduct()`;
  - `lru-cache.ts`;
  - `tenant-directory.ts`;
  - `tenant-context.ts`: `TenantContext` and `@CurrentTenant()`;
  - `tenant-connection.service.ts`;
  - `tenant.guard.ts`;
  - `company-unavailable.ts`;
  - `tenancy.module.ts`, which registers the global guards.
- **Other API changes:**
  - Health and branding are `@Public()`, and `/auth/context` is `@SessionOnly()`.
  - SessionService answers 401 for Better Auth 4xx refusals.
  - `createApp` and `AppModule.forRoot` take extra modules, for tests.
- **Tests:**
  - `packages/db/test/slug.test.ts`.
  - `provision-tenant.int.test.ts`: 5 tests with real databases.
  - `apps/api/test/lru-cache.test.ts`.
  - `isolation.int.test.ts`: 13 tests, with the test-only `support/isolation-probe.ts`.
  - The harness provisions real company databases.
  - The API integration `hookTimeout` is now 60 s, after teardown timed out under parallel database drops.
- **Docs:**
  - ADR 0030.
  - docs/api-contract.md: a Tenancy section.
  - docs/environment.md: `TENANT_POOL_CACHE`.
  - docs/blueprint-delta.md: a P9 row.

## Decisions and why
See ADR 0030. In short:
- The company only ever comes from the verified session, through a TenantContext with a private constructor.
- The guards are global, so a forgotten decorator fails closed.
- Suspended, cancelled and maintenance companies are read-only, and a database that is not ready answers 503.
- An existing account becomes owner only with `--reuse-owner`.
- The deferrals are in "Deferred" above and in the blueprint delta.

## Reviews
- **First security review (security-reviewer), at `8209097`:** 0 blocking. Mediums 1–2 and lows 3–4 were fixed in `1802660`. Low 5 (deny routes that declare no product) goes to P10. Low 6 (CREATE ROLE password in DDL logs, existing code) goes to STATUS. The summary is posted on PR #6.
- **Fresh re-review at `1802660`:** its summary is posted on PR #6.
- **Schema reviewer:** not needed, because no schema or migration changed.

## Commands run and results
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: pass.
- `pnpm test`: api 31, web 13, db 11, shared 330, providers 11; all pass.
- `pnpm test:api`: api 85 (13 isolation), db 11 (5 provisioning), providers 2; all pass.
- `pnpm db:provision-tenant`: the usage and reserved-slug errors were checked by hand. No company was created in the developer database.

## What is left
- **Owner:** make the CI `verify` job (which runs the isolation suite) a required check in GitHub branch protection for `main`.
- **P10:**
  - deny company routes that declare no product;
  - default roles in a new company database;
  - sync `member.role` with role assignment.
- **Later:** `move-tenant` with `invalidate(companyId)`, company defaults at onboarding, and plans and subscriptions (owner decision).

## Next prompt
"/resume. Continue the work queue: P10 (R4) on feat/permissions-guards-audit from an up-to-date main."
