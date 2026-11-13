# ADR 0030: Company provisioning, TenantConnectionService and isolation (P9)

- **Status:** accepted, 2026-11-13
- **Context:** blueprint P9 (R3) and p13 "Company provisioning"; CLAUDE.md rules 1 to 3. The owner narrowed the task to the setup script, one database per company, TenantConnectionService and isolation tests, on the local Postgres provider only. The owner was away and asked for the safest option on anything open.

## Decisions

### Provisioning
- `provisionTenant` in packages/db, with the CLI `pnpm db:provision-tenant`, creates a company in two steps:
  1. The control rows, in one transaction: `tenants` (status `trial`), `organization` with the same id, `tenant_products`, default `tenant_branding` from `PRODUCT_DEFAULT_BRANDING` (packages/shared), and the owner as `user` plus `member` with the role key `owner`.
  2. The company's own database through DatabaseProvisioner, migrated to the current schema (`provisionCompany`). The connection string is stored only encrypted with AES-256-GCM.
- **Resuming:** a run that stopped between the two steps is finished by running it again with the same slug. A slug that already has a database is refused, never overwritten.
- **Slugs:** 2–31 lowercase letters and digits, starting with a letter, because a slug is both a subdomain and part of the database name. Platform subdomains are reserved (`RESERVED_SLUGS`: www, api, app, admin, hr, flooring and others).
- **The owner** is reused when a user with that email exists (one user per person, blueprint p12). Otherwise a new unverified user is made, without a password. They sign in once invitation acceptance exists.

### TenantConnectionService
- It is the only way to a company database. Its one method, `db(tenant)`, takes a `TenantContext`, never a bare id.
- `TenantContext` has a private constructor. Only `TenantContext.fromVerifiedSession(session, company)` makes one, and TenantGuard calls it after its checks. So the company cannot come from a path, query, body or header (rule 2).
- Pools are cached per company in a small in-house LRU (`TENANT_POOL_CACHE`, default 20, 3 connections each). An evicted pool is closed after its running queries finish, and all pools close at shutdown. Parallel first requests for one company share one pool. No new dependency.
- A database that is not `ready` or `read_only` answers 503 `company_unavailable`.

### Guards: global, deny by default
- SessionGuard and then TenantGuard run on every Nest route (`APP_GUARD` in TenancyModule).
- `@Public()` skips both; only `/health` and `/public/branding` use it. `@SessionOnly()` skips the tenant check; only `/auth/context` uses it, because the chooser reads it before a company is open.
- TenantGuard refuses:
  - no open company, or a deleted one: `company_required`;
  - a membership removed during the session: `not_a_member`;
  - a company without the host's product or a route's `@RequireProduct()`: `product_not_enabled`;
  - writes to a suspended, cancelled or maintenance-mode company, or one whose database is `read_only`: `company_read_only`. Reading still works (blueprint p29, p40).
- Better Auth's own refusals in SessionService, such as a host outside `AUTH_ALLOWED_HOSTS`, now answer 401 instead of 500.

### Isolation tests
`apps/api/test/isolation.int.test.ts` provisions two companies with real separate databases on the docker server and mounts a test-only probe controller. The probe covers list, get, create, update and delete, through TenantConnectionService.

Signed in to company A:
- company B's ids in the path find nothing (404);
- `companyId` and `tenantId` in the query, body and headers are ignored;
- switching to B is refused;
- B's rows never change.

The suite also proves that every non-public Nest route answers 401 without a session (route inventory). It runs in `pnpm test:api`, which is part of CI `verify`.

## Left for later (blueprint delta)
- **`move-tenant`** (maintenance mode, pg_dump/pg_restore, checksums, connection swap): it needs a second provider and the pg_dump binaries.
- **Making the isolation suite a *required* check:** a GitHub branch-protection setting, which the owner sets.
- **Company defaults in a new database** (roles, settings, document sequences, tax): P10 roles and onboarding. Until then a new company has no roles and an empty permission ceiling, so it is denied by default.
- **Plans and subscriptions:** a new company is `trial` with no subscription row, because plan prices are an open owner decision.

## Rejected
- **A tenant id parameter on TenantConnectionService:** any caller could pass one from a request.
- **An LRU library:** about 40 lines cover what is needed.
- **Per-route opt-in guards:** a forgotten decorator would leave a route open; global guards make forgetting fail closed.
