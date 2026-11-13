# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/tooling-claude-agents` | A (task taken over from B) | Claude tooling from blueprint p35/p41: `/feature` and `/review` commands, security-reviewer (opus), test-writer and schema-reviewer (sonnet) subagents, Stop hook reminding to `/handoff` | Ready PR, rebased onto main after #2 merged. Waiting for B to review and merge | [#3](https://github.com/TwoWayTech/flooring-platform/pull/3) | the rebased handoff commit |
| `feat/auth-mfa` | A | P8 part 2: TOTP and backup codes, passkeys, mandatory MFA, rate limits and lockout, `GET /public/branding?host=` | Created from main, no commits yet | none | `aa5bb7d` (main) |
