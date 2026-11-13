# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/auth-mfa` | A | P8 part 2: TOTP and backup codes, passkeys, mandatory MFA, rate limits and lockout, `GET /public/branding?host=`. Also the PR #2 review fixes and the self-merge rule | Rebased onto main. Schema and security reviews done and their blocking findings fixed. Re-review, ready, then self-merge under the CLAUDE.md rule | [#4](https://github.com/TwoWayTech/flooring-platform/pull/4) | the handoff commit after `7d469f4` |
| `feat/auth-better-auth` | A | P8 part 1 | Merged in PR #2 (`31e2297`). The branch can be deleted | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | `cd0115c` |

PR #3 (`feat/tooling-claude-agents`) was merged on 2026-11-13 (`ab57891`), and its branch is deleted from origin. A did B's reviews and merges that day, because B's internet was down.
