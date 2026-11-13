# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/tenancy-company-databases` | A (Claude, work queue) | P9: company provisioning, TenantConnectionService, global deny-by-default guards and the isolation suite (ADR 0030) | Security review done (0 blocking) and its findings fixed. Re-review, then ready, CI and self-merge under the CLAUDE.md rule | [#6](https://github.com/TwoWayTech/flooring-platform/pull/6) | the handoff commit after `1802660` |
| `feat/auth-better-auth` | A | P8 part 1 | Merged in PR #2 (`31e2297`). The branch can be deleted | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | `cd0115c` |

Merged on 2026-11-13, with their branches deleted from origin:
- PR #3 (`feat/tooling-claude-agents`, `ab57891`): A did B's reviews and merges that day, because B's internet was down.
- PR #4 (`feat/auth-mfa`, `0ec9f6c`) and PR #5 (`fix/auth-lockout-refinements`, `1c47288`): self-merged by Claude under the CLAUDE.md rule.
