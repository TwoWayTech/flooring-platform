# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/hr-commissions` | A (Claude) | Commissions: plans, assignments, statements, adjustments, postings and the payroll handoff (ADR 0048) | Draft | to open | this commit |
| `feat/auth-better-auth` | A | P8 part 1 | Merged in PR #2 (`31e2297`). The branch can be deleted | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | `cd0115c` |

Merged on 2026-11-14: PR #16 (`feat/ledger-core`, `328ca36`), self-merged by Claude under the CLAUDE.md rule.

Merged on 2026-11-13, with their branches deleted from origin:
- PR #3 (`feat/tooling-claude-agents`, `ab57891`): A did B's reviews and merges that day, because B's internet was down.
- PR #4 (`feat/auth-mfa`, `0ec9f6c`), PR #5 (`fix/auth-lockout-refinements`, `1c47288`) PR #6 (`feat/tenancy-company-databases`, `429149d`), PR #7 (`feat/permissions-guards-audit`, `39e6a33`) PR #8 (`fix/access-audit-hardening`, `59ce4e4`) and PR #9 (`feat/notifications-core`, `38bf221`) PR #10 (`fix/platform-owner-decisions`, `a1b0840`) PR #11 (`feat/settings-users-roles`, `2ddf5bc`) PR #12 (`feat/inventory-catalog`, `2d483de`), PR #13 (`feat/purchasing-orders`, `a66a49d`) PR #14 (`feat/sales-customers-quotes`, `2dcb6e8`) PR #15 (`feat/sales-invoices`, `f8b0ef4`), PR #16 (`feat/ledger-core`, `328ca36`) and PR #18 (`fix/sales-invoice-company-day`, `82535cd`): self-merged by Claude under the CLAUDE.md rule.
- PR #17 (`fix/deploy-vercel-demo-only`, `9b6cbd0`): merged by the owner on 2026-11-14.
- PR #19 (`feat/ledger-accounting-settings`, `157f8ae`) PR #20 (`feat/finance-expenses`, `1ba1019`) PR #21 (`feat/ledger-bills-supplier-payments`, `881712f`) PR #22 (`feat/inventory-issue-cut`, `069ccb3`) PR #23 (`feat/contracts-register`, `59ce102`) PR #24 (`feat/contracts-billing`, `2e0a846`), PR #25 (`feat/hr-people`, `57664d9`, HR part 1, ADR 0046) and PR #26 (`feat/hr-payroll`, `ba3902d`, HR part 2, ADR 0047): self-merged by Claude on 2026-11-14.
