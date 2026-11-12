# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `2026f30` |
| `feat/auth-better-auth` | A | P8 part 1: Better Auth sign-in, email verification, per-company session timeouts, organizations = tenants, real login page in api mode | Draft PR; needs /security-review, then ready for review | [#2](https://github.com/TwoWayTech/flooring-platform/pull/2) | the handoff commit after `dfe9394` |
