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

## Switch check in a browser
- On a throwaway branch (`verify/meetings-off`, in a separate git worktree so the shared folder and its running servers were untouched), `meetings.calendar` was switched off, built with `pnpm build` and served with `next start` on port 3200.
- Checked with Playwright MCP screenshots, in both products (Summit Owner, Harbor Owner): the Meetings menu item is gone; `/meetings` shows "This feature is switched off in this demo."; the command palette has no Meetings entry; the presenter guide drops the Meetings step and renumbers (Flooring 13 steps, HR Suite 7); no console errors or warnings.
- The full suite against that build, without retries: 183 passed, 6 failed. All 6 open the Meetings page or its New meeting dialog (meetings.spec x3, two a11y dialog checks and one offline-save check that use the Meetings form), so they fail as expected. The screen checks on `/meetings` (layout, console, accessibility) pass on the switched-off page.
- Small gap: with a feature off, the browser tab title still names it (for example "Meetings | Flooring Suite"), because the page metadata comes from the route. The page body is correct.
- The branch was never committed or pushed, and is deleted.

## Production redeploy
- `vercel deploy --prod` of commit `17161ae` (every switch on): deployment `dpl_46PEHPUwSwyDzNxWk4dpw1XSUhg6`; both hostnames point at it.
- Full suite against both live addresses: 189 passed in 5.8 minutes, no retries.
- `.vercelignore` now also leaves out `.claude/settings.local.json`.
- `.claude/settings.json` now allows `vercel` commands without a prompt, at the owner's request.

## Commands run
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (102 unit tests), `pnpm build`: pass.
- `E2E_FLOORING_URL=… E2E_HR_URL=… pnpm test:e2e` against production: 189 passed (before and after the redeploy).

## Next
After the client demo: fill in docs/feedback-demo.md and run `/feature-change` for each decided request.
