# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/permissions-guards-audit` | A (Claude, work queue) | P10 part 1: permissions in the API, sensitive fields, append-only audit (ADR 0031) | Security and schema reviews done and their findings fixed; fresh re-review, then ready, CI and self-merge under the CLAUDE.md rule | [#7](https://github.com/TwoWayTech/flooring-platform/pull/7) | the handoff commit after `75b1b66` |
| `feat/auth-better-auth` | A | P8 part 1 | Merged in PR #2 (`31e2297`). The branch can be deleted | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | `cd0115c` |

Merged on 2026-11-13, with their branches deleted from origin:
- PR #3 (`feat/tooling-claude-agents`, `ab57891`): A did B's reviews and merges that day, because B's internet was down.
- PR #4 (`feat/auth-mfa`, `0ec9f6c`), PR #5 (`fix/auth-lockout-refinements`, `1c47288`) and PR #6 (`feat/tenancy-company-databases`, `429149d`): self-merged by Claude under the CLAUDE.md rule.
