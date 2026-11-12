# Branches

Every open branch, updated by /handoff. One task per branch, named `feat/<area>-<name>` or `fix/<area>-<name>`, created from `main`. Branches leave this list when their PR is merged and the branch is deleted.

| Branch | Owner | Purpose | Status | PR | Last commit |
| --- | --- | --- | --- | --- | --- |
| `demo` | both | The clickable demo, from tag `demo-v3`. Production on Vercel deploys from it (docs/deploy.md). Never merged into main | Long-lived | none | `e082445` |
| `feat/platform-base` | A | Real-build base: API, db, providers, CI, handoff system, data-source switch, real-build plan | Draft PR, waiting for review; CI `fast` green | [#1](https://github.com/TwoWayTech/flooring-platform/pull/1) | the handoff commit after `a227d11` |
