# Flooring Platform: rules for Claude (real build)

## What this is
A multi-tenant platform for US businesses with two products from one codebase: Flooring Suite (retail, wholesale, contracts, HR) and HR Suite (its own host). There is one control database plus one PostgreSQL database per company.

The clickable demo lives on branch `demo` (tag `demo-v3`). `main` is the real product.

- Plan of record: docs/blueprint/blueprint.pdf. Open only the section a task needs. Changes since then are in docs/blueprint-delta.md.
- Build plan and module order: docs/real-build-plan.md
- Module specs (source of truth for behaviour): docs/product-spec/<module>.md
- Data model and table mapping: docs/data-model.md
- API contract and conventions: docs/api-contract.md
- Feature switches: docs/FEATURES.md
- Design: docs/design-brief.md
- Environment variables: docs/environment.md
- Progress: docs/STATUS.md and docs/BRANCHES.md

## Every session
- Start with /resume. End with /handoff: session log, STATUS, BRANCHES, commit, push and a draft PR. Run it before the usage limit runs out, not after.
- One task per branch, named feat/<area>-<name> or fix/<area>-<name>, created from main. Never commit to main and never push it. Changes reach main only through a pull request that the other person merges.
- Push after every commit: `git push origin <branch>`. Nothing important may exist only on one laptop or in this chat.
- Keep PRs as drafts while working. Mark one ready only when it is done, because ready PRs run the expensive CI (docs/real-build-plan.md, CI budget).

## Stack
- pnpm + Turborepo.
- apps/web: Next.js App Router, TypeScript strict, Tailwind v4, shadcn/ui, Motion.
- apps/api: NestJS 12, bundled with tsup and SWC (ADR 0028).
- packages/db: Drizzle with postgres.js. Control schema in src/control, company schema in src/company.
- packages/providers: DatabaseProvisioner, StorageProvider and EmailProvider adapters.
- packages/shared: rules, types, permissions, units, money and Zod. packages/ui: components.
- Auth: Better Auth (P8). Jobs: pg-boss (later).
- Tests: Vitest and Playwright.
- Demo mode is NEXT_PUBLIC_DATA_SOURCE=demo (DemoStore, no database). Api mode is NEXT_PUBLIC_DATA_SOURCE=api.

## Commands
- `docker compose up -d` starts PostgreSQL 16 locally. Run `docker compose stop` when done.
- `pnpm dev` | `pnpm dev:api` | `pnpm build` | `pnpm lint` | `pnpm typecheck` | `pnpm test`
- `pnpm test:api` runs API and database tests and needs the local Postgres.
- `pnpm test:e2e` | `pnpm test:e2e:smoke`
- `pnpm db:generate` | `pnpm db:migrate` (control, then every company) | `pnpm db:seed` (Summit Floor Co.)

## Non-negotiable rules
1. Screens read and write only through the ApiClient (`apps/web/src/lib/api`). A module moves to the real API by adding its methods to API_METHODS; screens do not change. Never import fixtures in components.
2. Reach a company database only through TenantConnectionService, with the company taken from the verified session. Never take a tenant from a path, query or body.
3. Every endpoint checks product, module, permission and data scope. Deny by default.
4. Permissions come from packages/shared and only from there; API guards call the same engine. Effective = role permissions ∩ company ceiling ∩ enabled modules. Nobody grants more than they hold.
5. Cost, margin, pay rate and credit limit need view_sensitive, and the server strips them. Hiding them on screen is not enough.
6. Money, quantities and rates use decimal.js and are decimal strings in JSON. Display them only through formatNumber or `<Num>`. Never JS floats, never toFixed in UI code.
7. Square feet is the one area unit (ADR 0027): prices and costs per sq ft, boxed goods in whole cartons, rolls in ft. Store area in sq ft and length in ft; convert with packages/shared units.
8. Tables follow the blueprint table rules, which `packages/db/test/table-rules.int.test.ts` enforces:
   - UUID v7 ids
   - created_at, updated_at and created_by on every table
   - deleted_at on every business table; logs and ledgers are append-only instead
   - numeric(14,2) money, (14,4) unit cost, (14,3) quantity, (18,8) rates
   - links to users are plain uuid columns, because users live in the control database
9. Posted invoices, bills and payments are immutable: reverse them, never edit them. Statuses and balances that the ledger derives are never stored (ADR 0013).
10. Every financial event posts a balanced journal entry through LedgerService (P12). Every create, update or delete of a business record writes audit_log.
11. Outside services only through packages/providers. Plain PostgreSQL only: no provider-specific SQL, and only standard TCP drivers.
12. Tax, currency, units and payroll rules come from company settings and the country pack, never hard-coded.
13. Feature switches live in packages/shared/src/features.ts and docs/FEATURES.md, kept in sync by a test. A switched-off feature is hidden everywhere: screens, menus, palette, API. Use /feature-change to add, change or remove one, and record it in docs/blueprint-delta.md.
14. No secrets in code, logs, tests or session notes. Never read or edit .env files; docs/environment.md lists the variable names. No Social Security or bank account numbers are stored. Use invented names, never real manufacturers' brands or logos.
15. Colors only through CSS variables and tokens, in both themes. Responsive from 375 px, visible focus, respect prefers-reduced-motion. Follow docs/design-brief.md and use the frontend-design skill for UI work.

## Workflow
- Read the module's spec first. If none exists, draft docs/specs/<module>-<feature>.md and ask for approval.
- Use plan mode for changes that touch more than 3 files.
- Write tests with every change: unit, API (supertest against Postgres) and Playwright UI.
- Run lint, typecheck and tests before calling a task done, and report what you ran.
- Ask before adding a dependency, altering an existing table, or touching auth, tenancy or providers. Record new libraries in docs/adr/.
- Build a feature with `/feature <module>`; run `/review` before opening a PR. Subagents in .claude/agents: test-writer writes API and Playwright tests from a spec, schema-reviewer checks packages/db changes, and security-reviewer checks anything touching auth, tenancy, permissions or money. A Stop hook reminds you to `/handoff` when the tree is dirty or today's session log is missing.
- Conventional commits. Squash-merge PRs. The other person reviews every PR, and nothing merges with red CI.

## Testing on a laptop (learned in the demo)
- Run e2e against a production build: `pnpm build`, then the app starts.
  - Use 2 Playwright workers (`E2E_WORKERS=1` when memory is tight).
  - Run in chunks by project (`--project=flooring`, `--project=hr`) or by folder.
- Run one server at a time and stop it after each run. On Windows, find the process that holds the port with `netstat -ano` and stop it; a stale server silently serves the old build.
- Switching between NEXT_PUBLIC_DATA_SOURCE=demo and api needs a new `pnpm build`, because the value is inlined at build time.
- Docker Postgres is the only database for tests. Integration tests create throwaway databases and drop them. Stop Postgres when you are done.

## Style
- TypeScript strict, no `any`, named exports. Small focused files and functions, clear names, no dead or commented-out code, no duplicated logic. Prettier and ESLint must pass.
- Feature folders in web; one folder per module in apps/api/src/modules.
- Every exported function, component, hook and type gets a short JSDoc saying what it does and why. Business rules (tax, costing, units, permissions, ledger) get a comment that explains the rule and points to the spec section. No comments that only repeat the code.
