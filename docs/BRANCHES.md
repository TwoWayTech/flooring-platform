# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `fix/platform-owner-decisions` | A (Claude, work queue 2) | Task 1: the owner's decisions (company life cycle, maintenance on a failed migration), Retry and `scheduledFor`, explicit `gh pr` allows (ADR 0033) | Schema review clean; security re-review running; then ready, CI and self-merge | [#10](https://github.com/TwoWayTech/flooring-platform/pull/10) | `46701bc` |
| `feat/auth-better-auth` | A | P8 part 1 | Merged in PR #2 (`31e2297`). The branch can be deleted | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | `cd0115c` |

Merged on 2026-11-13, with their branches deleted from origin:
- PR #3 (`feat/tooling-claude-agents`, `ab57891`): A did B's reviews and merges that day, because B's internet was down.
- PR #4 (`feat/auth-mfa`, `0ec9f6c`), PR #5 (`fix/auth-lockout-refinements`, `1c47288`) PR #6 (`feat/tenancy-company-databases`, `429149d`), PR #7 (`feat/permissions-guards-audit`, `39e6a33`) PR #8 (`fix/access-audit-hardening`, `59ce4e4`) and PR #9 (`feat/notifications-core`, `38bf221`): self-merged by Claude under the CLAUDE.md rule.
