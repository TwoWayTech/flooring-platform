# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/notifications-core` | A (Claude, work queue) | The notifications core: pg-boss, the Outbox worker, in-app notes, the 30-day auth cleanup (ADR 0032) | Three security reviews; the last found nothing blocking. Ready, CI, then self-merge under the CLAUDE.md rule | [#9](https://github.com/TwoWayTech/flooring-platform/pull/9) | the handoff commit after `e68f714` |
| `feat/auth-better-auth` | A | P8 part 1 | Merged in PR #2 (`31e2297`). The branch can be deleted | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | `cd0115c` |

Merged on 2026-11-13, with their branches deleted from origin:
- PR #3 (`feat/tooling-claude-agents`, `ab57891`): A did B's reviews and merges that day, because B's internet was down.
- PR #4 (`feat/auth-mfa`, `0ec9f6c`), PR #5 (`fix/auth-lockout-refinements`, `1c47288`) PR #6 (`feat/tenancy-company-databases`, `429149d`), PR #7 (`feat/permissions-guards-audit`, `39e6a33`) and PR #8 (`fix/access-audit-hardening`, `59ce4e4`): self-merged by Claude under the CLAUDE.md rule.
