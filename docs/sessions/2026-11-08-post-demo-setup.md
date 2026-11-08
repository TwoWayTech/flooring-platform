# Session 2026-11-08: post-demo setup

## What was done
- Playwright now has one project per product. `flooring` and `hr` take their addresses from `E2E_FLOORING_URL` and `E2E_HR_URL` and fall back to the local dev server. HR Suite tests carry `@hr` and sign in to Harbor Staffing only; the Summit half of the pay-rate test became a Flooring test. Phone checks run inside each project with `test.use(PHONE)`. Remote runs use 2 workers, 2 retries, a 180 s test timeout and longer waits.
- Against production: 189 passed (156 Flooring, 33 HR Suite) in 5.9 minutes, with no retries used.
- Feature register: docs/FEATURES.md (31 features) and `packages/shared/src/features.ts` with a switch per key. The app checks the switches in menus, a route gate, tabs, buttons, palette actions, guide steps, attention checks, shell controls, sign-in and the platform admin layout and login route. ADR 0004.
- docs/feedback-demo.md (template with the blueprint's 13 open questions), `.claude/commands/feature-change.md`, docs/blueprint-delta.md, README.demo.md, and a short README.md that the real product's README will replace.

## Decisions
- Product in the register is `flooring`, `hr` or `both`; `both` marks platform features (Settings, sign-in, shell, Meetings) rather than listing each twice.
- Switches are code constants, so turning one off needs a redeploy. No runtime override, to keep a single switch per feature.
- With the auth.step-up switch off, the code dialog confirms at once instead of every caller handling it.

## Not verified
- The switched-off state was checked by unit tests (route ownership, link filtering, removed features) and by review, not in a browser: the local dev server was stopped earlier for low memory, and production still runs the previous build. All switches are on, so the live demo behaves as before.

## Commands run
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (102 unit tests), `pnpm build`: pass.
- `E2E_FLOORING_URL=… E2E_HR_URL=… pnpm test:e2e` against production: 189 passed.

## Next
Redeploy production (ask first), rerun the suite against it, then use docs/feedback-demo.md and `/feature-change` after the client demo.
