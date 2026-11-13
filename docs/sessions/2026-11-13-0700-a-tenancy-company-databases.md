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
