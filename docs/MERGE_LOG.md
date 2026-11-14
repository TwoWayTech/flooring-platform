# Merge log

One line per change that lands on `main`, appended by `.github/workflows/merge-log.yml`. Do not edit by hand. GitHub keeps the full push and pull request history as well.

| Date | PR | Title | Author | Branch | Commit |
| --- | --- | --- | --- | --- | --- |
| 2026-11-12 | #1 | Real-build base: API, database, providers, CI and handoff system | @TwoWayTech | feat/platform-base | `7f6baf7` |
| 2026-11-13 | #2 | P8 part 1: Better Auth sign-in | @TwoWayTech | feat/auth-better-auth | `31e2297` |
| 2026-11-13 | #3 | Claude tooling: /feature, /review, three subagents and a Stop hook | @TwoWayTech | feat/tooling-claude-agents | `ab57891` |
| 2026-11-13 | #4 | P8 part 2: MFA, passkeys, lockout, rate limits, public branding | @TwoWayTech | feat/auth-mfa | `0ec9f6c` |
| 2026-11-13 | #5 | fix(auth): lockout refinements from the PR #4 review | @TwoWayTech | fix/auth-lockout-refinements | `1c47288` |
| 2026-11-13 | #6 | P9: company provisioning, TenantConnectionService and isolation | @TwoWayTech | feat/tenancy-company-databases | `429149d` |
| 2026-11-13 | #7 | P10 part 1: permissions, sensitive fields and audit in the API | @TwoWayTech | feat/permissions-guards-audit | `39e6a33` |
| 2026-11-13 | #8 | fix(access): audit and module hardening from the PR #7 re-review | @TwoWayTech | fix/access-audit-hardening | `59ce4e4` |
| 2026-11-13 | #9 | Notifications core: pg-boss, the Outbox worker and the 30-day auth cleanup | @TwoWayTech | feat/notifications-core | `38bf221` |
| 2026-11-13 | #10 | Owner decisions: company life cycle, maintenance on failed migration, Retry schedule | @TwoWayTech | fix/platform-owner-decisions | `a1b0840` |
| 2026-11-13 | #11 | P10 part 2: Users and Roles API, step-up, invitations, password reset, support access | @TwoWayTech | feat/settings-users-roles | `2ddf5bc` |
| 2026-11-13 | #12 | P11 inventory part 1: catalog, rolls, ledger, transfers and stock correction on the API | @TwoWayTech | feat/inventory-catalog | `2d483de` |
| 2026-11-13 | #13 | P11 purchasing part 1: suppliers, contacts, orders and receipts on the API | @TwoWayTech | feat/purchasing-orders | `a66a49d` |
| 2026-11-13 | #14 | P11 sales part 1: customers, quotes and the tax engine on the API | @TwoWayTech | feat/sales-customers-quotes | `2dcb6e8` |
| 2026-11-13 | #15 | P11 sales part 2: invoices, payments, credits and refunds on the API | @TwoWayTech | feat/sales-invoices | `f8b0ef4` |
| 2026-11-14 | #16 | P12 ledger part 1: LedgerService, journal and sales postings | @TwoWayTech | feat/ledger-core | `328ca36` |
| 2026-11-14 | #18 | fix(api): read invoice dates in the company's time zone | @TwoWayTech | fix/sales-invoice-company-day | `82535cd` |
| 2026-11-14 | #17 | fix(deploy): only demo deploys on Vercel; self-merge counts GitHub Actions; guard ignores PR comment text | @TwoWayTech | fix/deploy-vercel-demo-only | `9b6cbd0` |
| 2026-11-14 | #19 | P12: accounting settings and bank accounts per payment method (ADR 0040) | @TwoWayTech | feat/ledger-accounting-settings | `157f8ae` |
| 2026-11-14 | #20 | P12 part 2: expenses on the API with postings and recurring drafts (ADR 0041) | @TwoWayTech | feat/finance-expenses | `1ba1019` |
| 2026-11-14 | #21 | P12 part 3: bills, supplier payments and stock postings (ADR 0042) | @TwoWayTech | feat/ledger-bills-supplier-payments | `881712f` |
| 2026-11-14 | #22 | Inventory part 2: issue and cut with cost of goods, roll quick invoice, commission split (ADR 0043) | @TwoWayTech | feat/inventory-issue-cut | `069ccb3` |
| 2026-11-14 | #23 | Contracts part 1: register, change orders, waivers and insurance on the API (ADR 0044) | @TwoWayTech | feat/contracts-register | `59ce102` |
| 2026-11-14 | #24 | Contracts part 2: progress billings and retainage with postings (ADR 0045) | @TwoWayTech | feat/contracts-billing | `2e0a846` |
| 2026-11-14 | #25 | HR part 1: people, timesheets and time off on the API (ADR 0046) | @TwoWayTech | feat/hr-people | `57664d9` |
