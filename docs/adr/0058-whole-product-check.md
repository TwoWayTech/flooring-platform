# 0058. The whole-product check

- **Status:** accepted 2026-11-20 (built 2026-11-16 to 2026-11-20 on `feat/check-whole-product`, draft PR #43).
- **Context:** owner's queue item 6 and STATUS "Next three tasks" item 3: compare the specs, the feature register and the demo script with what runs on the real API; prove the books always agree with the documents; call every endpoint as every role and as another company's user; make a fresh company with the setup script, import sample CSV data and walk the demo script in api mode. Built unattended under the decision rule (take the safest option, record it). Session log: docs/sessions/2026-11-16-1241-b-whole-product-check.md. Report: docs/whole-product-check.md. Item by item: docs/real-build-coverage.md.

## Decision

The check is a set of tests that stay in the repo, plus a report. It changes no product code.

| Piece | Where | Runs in |
| --- | --- | --- |
| Generated coverage list and page gates (CV-1 to CV-9, PG-1 to PG-4), money in the UI (UI-1) | `apps/web/tests/unit/{coverage-list,page-gates,money-in-ui}.test.ts`, `coverage-scan/`; generated `docs/coverage.md`, `tests/e2e-api/check/{page-coverage,page-gates}.json` | `pnpm test` |
| Route matrix (PM-1 to PM-7, MI-DEC): the real guard chain against an oracle built only from packages/shared, every company route × every default role, another company's host, switches, data scope on Summit, sensitive fields, decimal strings | `apps/api/test/route-matrix.int.test.ts`, `support/route-*.ts`; snapshots `__snapshots__/route-requirements.json`, `route-role-matrix.txt` | `pnpm test:api` |
| Money integrity (MI-1 to MI-9, E1 to E15, R1 to R6) | `money-integrity.int.test.ts`, `new-company.int.test.ts` (MI part) | `pnpm test:api` |
| A bare new company (FA-0 to FA-12) and a fresh company from the setup script with sample CSV data (FS-1 to FS-6) | `new-company.int.test.ts`, `fresh-setup.int.test.ts`, `fixtures/fresh-company/*.csv` | `pnpm test:api` |
| Test-only fresh-company helpers (FH-1 to FH-3) | `packages/db/src/testing.ts`, `packages/db/test/fresh-company-helpers.int.test.ts` | `pnpm test:api` |
| Fresh company, demo script and page × persona matrix in the browser (FC, DS, PGM) | `apps/web/tests/e2e-api/check/*.spec.ts` | opt-in, `WHOLE_CHECK=1` |

Safest options taken (S-1 to S-16 of the plan, kept):

- **S-1:** the long variants and the e2e check specs are opt-in (`WHOLE_CHECK=1`); the default runs carry bounded guards.
- **S-2:** no product change. A gap is asserted as it behaves today, in a test that pins the exact status, code and words; a 5xx always fails; `test.fail` is never used.
- **S-3:** the money equalities are proven on companies made through the API, never on Summit's seeded history, which posted no journal entries.
- **S-4:** the oracle reads packages/shared only; the guards are the defendant; outcomes are reviewed snapshots.
- **S-5:** generated artifacts are vitest file snapshots with no dates or line numbers. Generation uses posix paths, so Windows, macOS and Linux produce the same bytes (2026-11-20).
- **S-6:** `turbo.json` inputs include every file the drift guards read; the cache is never turned off.
- **S-7:** the test-only provisioning helpers refuse a remote host, a provider other than plain PostgreSQL, a demo company and a seeded user, never log a password or token, and never write a credential; outside CI the e2e helpers act only on port 5433.
- **S-8:** retirement soft-deletes `tenant_databases` and `tenants`, revokes invitations, removes sign-in rows and drops the database, in one transaction.
- **S-9:** no `.github`, `CLAUDE.md` or `.claude/` change; CI and process questions go to the owner.
- **S-10:** older tests are not refactored.
- **S-11:** every reviewed list (demo-only calls, tolerated refusals, routes with no module or switch, reused field names, whole counts, float uses) has a reason per entry and a stale check.
- **S-12:** float use in UI money code is listed and followed up, not fixed.
- **S-13:** merged without `--delete-branch`.
- **S-14:** the money run's prelude reaches every event kind before the seeded random tail; refusals match status, code and words.
- **S-15:** the coverage list reads code and file names only, never doc contents.
- **S-16:** the demo-script walk reuses the flows' kit rather than copying it.

Decided on resuming (2026-11-20):

- **R-1, the fresh company from the setup script runs the real script.** FS-1 runs `scripts/provision-tenant.ts` as a child process against the test harness's control database, as `pnpm db:provision-tenant` does, so the company the API then serves is the one the owner's script makes. Why: the owner asked for the setup script, and the helpers call the same `provisionTenant` but not the script's argument handling and output.
- **R-2, stand-ins are written once and named.** Where the product has no way yet, FS pins the refusal first, then writes exactly what provisioning or the missing route would write: one Localization row (G2, `localizationRow`, the bootstrap's own), one branch row (G3) and one invitation row (G4). Everything after goes through the API. Why: it shows how far a new company really gets and proves the rest of the journey on the API, without hiding a gap.
- **R-3, sample CSV files are committed and read strictly.** `apps/api/test/fixtures/fresh-company/` holds invented suppliers, products, customers and addresses. A small RFC 4180 reader maps each header to the import kind's field label and throws on an unknown header. Why: the web parses files with SheetJS in a worker, which API tests can't load; a strict reader can't silently drop a column.
- **R-4, reused field names are reviewed per route and path.** `NAME_REUSED_AT` excuses a money-named field only at one route and JSON path (the currency code under `base`, an import mapping's `price` and `cost` headers), with stale checks in PM-7 and FS. Why: a path-only exemption would also excuse real money under the same name on another route.
- **R-5, the base was main plus PR #68's stack.** The resume merged `origin/main`, then `origin/feat/auth-passkey-screens` (PR #68, holding #62 and #64 to #67), as real merges. Conflicts were the same changes squashed on main and as branch commits on #68; each main version was found in #68's history, so #68's side was taken, and the product paths equal #68's tree.

- **R-6, the test helpers' database guards refuse rather than reason.** A URL a guarded helper may use is a `postgres:` or `postgresql:` URL on localhost or 127.0.0.1 with no fragment, no control character, space or backslash, the scheme followed at once by `//`, and no query option but `sslmode` (`redirectableUrl`); the opt-in specs add port 5433 unless on GitHub Actions. Why: postgres.js parses URLs itself and reads `host`, `hostaddr` and `port` from the query, so any shape where it and WHATWG URL could disagree is refused (security reviews, rounds 2 to 5).
- **R-7, route-level sensitive-key overrides are reviewed exactly** (`SENSITIVE_KEY_OVERRIDES`, PM-1 (h)). Why: the leak judge trusts a route's own `@SensitiveFieldKeys`, so a loosened override must fail somewhere other than a `-u` snapshot (security review, round 1).

## Consequences

- A PR that adds a route, an ApiClient method, a page rule or a role change regenerates `route-requirements.json`, `route-role-matrix.txt`, `docs/coverage.md`, `page-coverage.json` and `page-gates.json` (`-u` on the two test files) and reviews the diff; a new route with no module, no switch, a view key on a write or a reused money name fails until it is listed with a reason.
- P13's full regression (real-build-plan week 20) includes the opt-in suites: `WHOLE_CHECK=1 pnpm test:api` and `WHOLE_CHECK=1 pnpm --filter web test:e2e:api tests/e2e-api/check` on the throwaway 5433 database.
- Residual risks: the scans are regex-based (bounded by CV-8 and the reviewed lists); the matrix judges guard decisions, while in-handler rules (company-wide scope, Owner-only, separation of duties) are covered by their modules' own tests and listed in the report; the HR Suite is not walked in api mode (G6).

## Findings fixed
- **F-m (P3), 2026-11-20, `fix/api-whole-cartons`:** the API refuses a boxed line that isn't whole cartons (400, "<line>: sell whole cartons, multiples of <pack> sq ft.") on quote saves, quote conversion, purchase orders and receipts, and never rounds; one shared rule (`isWholeCartons`, `partCartonProblem`). Asserted in `sales.int.test.ts`, `invoices.int.test.ts` and `purchasing.int.test.ts`; MI-1 still sells whole cartons only, now because a part carton is refused (row 52).
