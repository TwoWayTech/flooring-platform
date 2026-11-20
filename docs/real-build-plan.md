# Real build plan

Written 2026-11-12, when the real build started on `main`. The demo stays on branch `demo` (tag `demo-v3`).

The blueprint's post-demo roadmap (p52) is a picture with no week-by-week text, so this file is the plan of record for the order and the weeks. Change it through a pull request.

## Where we start
The base is in place (PR from `feat/platform-base`, ADR 0028):
- apps/api: NestJS, health check, config, OpenAPI, Dockerfile.
- packages/db: control and company schemas, migrations, migrate-all, the Summit Floor Co. seed.
- packages/providers: Neon or Postgres, R2 or S3, Resend, and no-op adapters.
- docker-compose with PostgreSQL 16.
- CI and the handoff system.
- The web app's switch to `NEXT_PUBLIC_DATA_SOURCE=api`.

No business module is on the API yet.

## Who does what
The blueprint's account rule (p36, p38) applies: each person uses only their own Claude account. Switch people, not logins.

- **Person A, Max 20x ($200).** Backend:
  - schema changes, API endpoints, guards, ledger and security work;
  - parallel sessions in separate git worktrees when two backend tasks are independent.
- **Person B, Max 5x ($100).** Screens and tests:
  - moves each module's screens to the API (adds its methods to `API_METHODS`);
  - writes the Playwright API and UI tests from the acceptance criteria;
  - polish, docs and the demo branch.

Each module follows prompt **P11** (blueprint p46):
1. A spec, approved first.
2. Failing tests.
3. Schema and endpoints with guards, postings and audit.
4. The screen switched to the API.
5. A security review when auth, tenancy, permissions or money are touched.
6. A PR, then /handoff.

Person A starts a module's backend one week before Person B moves its screens, so B always has a working API to point at.

## Module order, product specs and blueprint prompts

| # | Module | Product spec | Blueprint prompt | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Login, MFA, control database, branding by host | settings-and-permissions.md (users, security) | **P8** | Base |
| 2 | Company provisioning and isolation | data-model.md; settings-and-permissions.md (platform admin) | **P9** | 1 |
| 3 | Permissions, audit, approvals | settings-and-permissions.md | **P10** | 2 |
| 4 | Settings (profile, localization, tax rules, numbers, branding upload, documents) | settings-and-permissions.md (settings pages) | P11 | 3 |
| 5 | Notifications core: events, rules, Outbox worker on pg-boss, in-app | notifications.md | P11 | 4 |
| 6 | Catalog and inventory: products, locations, rolls, stock ledger, transfers, reservations | inventory.md | P11 | 4 |
| 7 | Suppliers and purchasing: directory, POs, receipts, bills, supplier payments | purchasing.md | P11 | 6 |
| 8 | Customers and sales: addresses, quotes, tax, invoices, payments, credit notes, refunds | sales.md | P11 | 6, 5 |
| 9 | Ledger, expenses, payments queue | finance-expenses.md | **P12**, then P11 | 7, 8 |
| 10 | Contracts and progress billing | contracts.md | P11 (+ P12 postings) | 8, 9 |
| 11 | HR: people, timesheets, overtime, time off, pay periods; the HR Suite host | hr.md | P11 | 4, 5 |
| 12 | Commissions | commissions.md | P11 (+ P12) | 8, 11 |
| 13 | Employee portal | employee-portal.md | P11 | 11, 12 |
| 14 | Meetings, invites and .ics (ADR 0051: parts 1 and 2 the API, part 3 the screens on it, PR #37; part 4 waits for the owner) | meetings.md | P11 | 5 |
| 15 | Reports | reports.md | P11 | 8, 9, 11 |
| 16 | Data import and opening balances | import.md | P11 | 6 to 11 |
| 17 | Platform admin and manual billing | settings-and-permissions.md (platform) | P11 | 2, 3 |
| 18 | Security hardening before launch | all | **P13** | all |

**Why this order differs from the blueprint's list (p48):**
- Installation is switched off and replaced by Contracts (blueprint-delta 2026-11-10).
- Notifications moves early, because every module raises events into it.
- Settings comes before the modules that read it.
- Tax is part of Sales, because the tax engine already exists in packages/shared.

## Week by week
The plan assumes 15 to 20 hours a week each (blueprint p52). Re-plan once both people confirm their hours (open question 3). Week 1 starts Monday 2026-11-16. Weeks with US holidays (Thanksgiving, the last two weeks of December) carry less work.

| Week | Starts | Person A (backend) | Person B (screens, tests, docs) | Gate at the end of the week |
| --- | --- | --- | --- | --- |
| 1 | Nov 16 | Review and merge the base. P8 part 1: Better Auth email and password, verification, sessions and timeouts, organization plugin | Review the base PR. Add `/feature` and `/review` commands, the security-reviewer, test-writer and schema-reviewer subagents, and the Stop hook (blueprint p35, p41) | Base merged, CI green on main |
| 2 | Nov 23 (Thanksgiving) | P8 part 2: TOTP with backup codes, passkeys, rate limits, `GET /public/branding?host=` | Real sign-in, MFA enrolment and code screens in api mode; Playwright auth tests | Sign in with MFA against the local API |
| 3 | Nov 30 | P9: TenantConnectionService (AES-256-GCM, LRU cache), tenant and product guards, provision-tenant and move-tenant scripts | Company-isolation suite (signed in to A, every endpoint pattern against B fails), made a required check | Isolation tests pass in CI |
| 4 | Dec 7 | P10: guards for product, module, permission and data scope; sensitive-field serializer; ceiling; no escalation; step-up MFA; support grants; separation of duties; append-only audit | Users, roles and audit screens on the API; effective-access preview | Role-by-permission matrix test green; security review linked |
| 5 | Dec 14 | Settings module: profile, localization, tax rules and county rates, numbers, documents and sequences, branding upload through StorageProvider | All settings pages on the API; branding upload tests | Settings fully on the API |
| 6 | Dec 21 (holidays) | Notifications core: rules, Outbox, pg-boss worker, EmailProvider, in-app notifications | Outbox and notification settings screens, the bell | One real email sent through Resend from staging |
| 7 | Dec 28 (holidays) | Buffer: catch up and fix bugs; staging on Railway (API image), Neon and R2 | Buffer: catch up; demo branch fixes if the client asks | Staging reachable |
| 8 | Jan 4 | Inventory 1: products, locations, rolls, stock movements | Inventory list and roll detail on the API | Stock on hand derived from movements |
| 9 | Jan 11 | Inventory 2: transfers, reservations with row locking, correct stock count | Transfers, reservations and stock correction screens | Concurrent reserve test passes |
| 10 | Jan 18 | Purchasing 1: supplier directory and contacts, POs | Suppliers and PO screens | PO from draft to ordered on the API |
| 11 | Jan 25 | Purchasing 2: receipts into stock, bills with matching, supplier payments with review | Receipts, bills and supplier payment screens; payables | Receipt raises stock; bill paid and balance derived |
| 12 | Feb 1 | Sales 1: customers and addresses, quotes with rooms, tax resolution | Customers, quote builder on the API | Quote totals and tax match the shared engine |
| 13 | Feb 8 | Sales 2: invoices, reservations from invoices, payments with two-person check, credit notes, refunds | Invoices, payments to verify, statements | Invoice status derived from the payment ledger |
| 14 | Feb 15 | P12: LedgerService, postings for sales, purchasing and expenses, reversals, closed periods; expenses and recurring drafts | Expenses and payments-queue screens; property-based ledger tests with A | Trial balance zero for random document sequences |
| 15 | Feb 22 | Contracts: lifecycle, billing and retainage, change orders, waivers, insurance | Contract register and detail on the API | Retainage held off and released correctly |
| 16 | Mar 1 | HR 1: people, timesheets with overtime, clock, time off ledger | HR Home, people, timesheets, time off on the API; HR Suite host | Overtime matches the shared rules (federal and California) |
| 17 | Mar 8 | HR 2: pay periods and exports; commissions with statements; employee portal projection | Pay periods, commissions, `/my` portal | Approved period frozen; portal shows own data only |
| 18 | Mar 15 | Meetings with .ics through EmailProvider and reminders on pg-boss; reports (business report, P&L) | Calendar and reports on the API | Location profits add up to company profit |
| 19 | Mar 22 | Import on the server with undo; platform admin and manual billing | Import wizard and super-admin on the API | Summit's demo data imports through the wizard |
| 20 | Mar 29 | P13 with B: OWASP ASVS level 2 review, fix critical and high findings | P13 with A; full regression, including the whole-product check suites (`WHOLE_CHECK=1`, ADR 0058); launch checklist; external reviewer booked | docs/security-review.md written; no open critical or high findings |

## CI budget (GitHub Free: 2,000 Actions minutes a month)
GitHub bills each job separately, rounded up to whole minutes. Main isn't protected on GitHub Free, so the Claude Code deny rule in `.claude/settings.json` and the CLAUDE.md rules keep pushes off main.

| Workflow job | Runs on | Minutes per run (estimate) | Runs a month (estimate) | Minutes a month |
| --- | --- | --- | --- | --- |
| `fast`: lint, typecheck, unit tests | Every push to a branch other than main | 3 | 2 people × 8 pushes × 21 working days = 336, less about 15 % skipped (docs-only) or cancelled by a newer push = about 285 | about 855 |
| `verify`: fast + Postgres, migrations, seed, API tests, web build, smoke | Ready PRs to main, about 1.5 runs each | 10 | about 9 PRs × 1.5 = 14 | about 140 |
| `e2e`: full browser suite, both hosts | Ready PRs to main, after verify | 20 | about 14 | about 280 |
| `verify` on main | Each merge to main | 10 | about 9 | about 90 |
| `merge-log` | Each merge to main | 1 | about 9 | about 9 |
| **Total** | | | | **about 1,375 (69 %)** |

Measured 2026-11-20 (whole-product check, ADR 0058): ready-PR `verify` 10.6 to 18.0 minutes (its API step 3.5 to 7.1), `e2e` 9.3 to 17.6, so the estimates of 10 and 20 above are low for verify and about right for e2e. The check adds about 45 seconds to verify. `verify` and `merge-log` on main haven't run since 2026-11-14, because squash commits carry the branches' `[skip ci]` lines (owner question Q9).

The old design ran verify on every push. That cost about 285 × 10 = 2,850 minutes before any pull request, which is why only `fast` runs on branch pushes now.

**How to stay inside the budget:**
- **Watch usage.** Check GitHub → Settings → Billing and plans → Usage every Monday. Above 1,500 minutes by the 20th, apply the levers below.
- **Keep PRs as drafts while working.** A draft gets only `fast`. Mark it ready when done; every push to a ready PR re-runs `verify` and `e2e`.
- **Pushes that are only a backup** (mid-task WIP) can carry `[skip ci]` in the commit message.
- **Docs-only pushes** (`docs/**`, `*.md`) skip CI on their own.
- **Larger levers:**
  - GitHub Team at $4 per user a month gives 3,000 minutes and protected branches (blueprint p29).
  - A self-hosted runner on a spare machine uses no minutes.

## Open questions (blueprint p53)
1. Platform brand name and domain: this decides the hostnames and the `EMAIL_FROM` domain.
2. Legal entity.
3. Hours per week each person can commit: this re-plans the weeks above.
4. The client accountant's decisions (costing method, chart of accounts, tax registrations): these are needed before week 14 (P12).
5. Plan prices: the seed has zero prices until they are set.
