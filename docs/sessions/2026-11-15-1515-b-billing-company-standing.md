# Session 2026-11-15 15:15, B (Claude): platform admin part 4, the company side (standing, billing, support panel)

Person: B (Claude), on B's Mac. Branch `feat/billing-company-standing`, from main at `c763938` (platform admin part 3, PR #36, squash-merged; main also holds part 1, PR #34, and meetings parts 1 and 2, PRs #33 and #35). This is the main checkout, not a worktree. This is an unattended overnight run: the owner is asleep, so open points take the safest option and are recorded in docs/blueprint-delta.md and ADR 0054. The meetings build (part 3, PR #37, `feat/meetings-web-api`) runs at the same time in its own worktree (`/Users/sarah/dev/flooring-platform-meetings`) and shares the local PostgreSQL on 5432. This branch never touches that worktree, never stops Postgres, never drops a shared database, and never touches the `fp-e2e-worktree` container on 5433.

## Prompt (owner's queue order and decision rule)
- **Queue (owner, 2026-11-15, recorded in STATUS):** "Then the queue restarts in this order: meetings; platform admin and manual billing; reports; import; cross-module api-mode e2e flows; the whole-product check."
- **STATUS, "Next three tasks" 2:** after parts 1 and 3 (PRs #34 and #36), part 4 (`feat/billing-company-standing`) is `GET /company/standing`, the maintenance and suspended screens, the Owner's banner, a read-only billing page and the Owner's support-access panel. A reduced part 2 follows. Billing writes wait for the owner (ADR 0052, "For the owner" 7).
- **Overnight rule:** the owner is asleep. Pick the safest option and record it in docs/blueprint-delta.md.
- **How the orchestrating session applies the rule to this part:**
  - **Follow the spec.** docs/specs/platform-admin.md is the approved behaviour. Deviate only in the safer direction: less exposure, deny by default, and refuse what can't be done correctly. Record each deviation in docs/blueprint-delta.md and ADR 0054.
  - **No schema, dependency or core change:** no new or altered table, no migration, no new dependency, and no change at all in `apps/api/src/core/auth` or `apps/api/src/core/tenancy`. `git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy` must stay empty. If the plan can't be built without such a change, the build stops and reports it as an owner decision.
  - **Out of scope:** billing writes, and using a support grant.
  - **The new switch `settings.billing`** follows `.claude/commands/feature-change.md`: features.ts and docs/FEATURES.md kept in sync, hidden everywhere when off, the API included. Its step 2 asks the owner to confirm, which can't happen overnight, so the step-2 impact summary goes in the PR body and ADR 0054, and the key is owner question 27.
  - **Process:** heavy commands (integration tests, the full typecheck, lint and test, builds, Playwright, dev servers) run through the scratchpad lock, one at a time across both builds. Ports 3000 and 4000 must be free before and after any Playwright run or dev server. The owner's local env file is never opened, printed or edited. The orchestrating session updates docs/STATUS.md and docs/BRANCHES.md; this branch does not.

## Inputs
- **Behaviour sources:**
  - docs/specs/platform-admin.md: parts 1 and 3 as built, and the part 4 outline under "Parts 2 to 4";
  - ADR 0052 ("Later parts", part 4; "For the owner" 1, 2 and 7) and ADR 0053 ("Deferred": the Owner's panel);
  - ADR 0030 (tenancy and the session-only routes), ADR 0033 (the life cycle and maintenance) and ADR 0034 (support access);
  - docs/api-contract.md (Tenancy refusals, the support-access rows);
  - docs/product-spec/settings-and-permissions.md and docs/specs/settings-users-access.md ("Support access");
  - docs/FEATURES.md (the `settings.*` rows);
  - docs/STATUS.md: the platform admin residual risks, among them "The console says the Owner approves 'in Settings', but the web has no Owner screen for support access until part 4."
- **The code at `c763938`:** TenantGuard and TenantDirectory (read, not changed), the shared life-cycle rule (`company-lifecycle.ts`), `PlanLimits`, the users-side `SupportGrantsService` and its routes, the web's session helpers, the (app) layout and app shell, the settings menu and page rules, DemoStore and the demo console helpers.
- **Planning:** a part 4 plan, a critic's review of it (six must-fix items C1 to C6 and twenty should items), and a final plan that applies C1 to C6 and every should item but one, each re-checked against the code. Those files are in a temporary scratchpad, so the plan and its decisions are written out below.

## Plan (part 4, short)

### Stages (one commit each, pushed; every commit keeps `pnpm typecheck` green)
0. **Plan:** this log; the "Part 4: the company side" section of docs/specs/platform-admin.md, with the endpoints, fields, refusals and messages, screens, edge cases and acceptance criteria 40 to 63; owner questions 21 to 33 in that spec's "Waiting for the owner"; and the draft PR.
1. **Shared** (`packages/shared`):
   - `platform/company-standing.ts`: the five standing states, TenantGuard's order as a pure rule, the wire reader (unknown reads `unavailable`), and the three screens' copy;
   - `permissions/lifecycle-dates.ts`: `lifecycleHorizon`, `phaseReachedAt` and `phaseDates`, taken from `companyPhase` itself;
   - `permissions/company-lifecycle.ts`: export `PHASE_RANK` and `countedSubscriptions`, with no behaviour change;
   - `platform/company-billing.ts`: the Owner's billing view, each row's standing, the banner notice and its copy;
   - `platform/support-grants.ts`: the support messages, `supportGrantDecisionRefusal` and `supportActions`;
   - the types, the index, the `settings.billing` key with its docs/FEATURES.md row, and unit tests.
2. **API** (a new `apps/api/src/modules/billing`):
   - `GET /company/standing`, session-only, behind its own class-level `StandingMemberGuard`;
   - `GET /billing`, an ordinary company route for the Owner;
   - the support-grant service takes its messages from packages/shared, byte for byte;
   - a lint block that keeps the billing module off the company schema and TenantConnectionService, and the standing files off TenantContext, checked with two probe files;
   - integration tests S-1 to S-21 and B-1 to B-13, and a guard unit test.
3. **Web:**
   - the server gate in the (app) layout and the client `StandingGate` with the maintenance, unavailable and suspended screens (a full page on load, an alert dialog over the open screen later);
   - the standing watch on the ApiClient;
   - the Owner's banner;
   - /settings/billing, with an `ownerOnly` menu and page rule;
   - the Owner's Support access panel on Settings → Users;
   - the ApiClient methods and DemoStore, and unit tests.
4. **Browser tests:**
   - the demo `billing.spec.ts` and /settings/billing in the axe, console and 375 px lists;
   - the api-mode `company-standing.spec.ts`, run twice in a row to prove its clean-up;
   - test-only helpers in `packages/db/src/testing.ts`.
5. **Docs:** ADR 0054, the delta row, api-contract, ADR 0030's session-only list, the spec as built, docs/FEATURES.md, the product spec, the users spec, and one-line notes in ADRs 0033, 0052 and 0053.

After stage 5: the full checks, `/review`, then a fresh security-reviewer (the work is next to tenancy: a new session-only route and the Owner's approve and revoke from the web), with its summary posted on the PR. No schema-reviewer is needed: there is no schema change. Then the PR is marked ready, `verify` and `e2e` must be green, the PR self-merges under the CLAUDE.md rule, and `/handoff` runs.

### Key decisions (the full list is in "Decisions and why")
- **`GET /company/standing` answers one word,** `full`, `read_only`, `locked`, `maintenance` or `unavailable`, the same for every member. It is what TenantGuard would do to the member's next request, in TenantGuard's order. TenantGuard refuses before any company handler runs, so a company route can't answer for the states the screens need, and changing that would be a change in core/tenancy. So the route is session-only, behind a class-level guard of its own that repeats TenantGuard's membership checks on control rows only. It never builds a TenantContext and never opens the company database.
- **`GET /billing` is an ordinary company route.** TenantGuard and PermissionGuard run unchanged. The switch is checked before the Owner, so everyone gets 404 while `settings.billing` is off. It answers the plan name, product, interval, current period, a standing word per row, the limits and the Owner's notice. It never answers a price, an id, a plan key, a limit override or payment details.
- **Dates come from `companyPhase` itself.** A binary search up to an exact horizon finds when the company becomes read only and when it locks. There is no second copy of the ladder, and the copy never promises the account stays read only.
- **The web never loops and never remounts.** Only `StandingGate` reacts to a standing refusal, and only by reading standing, which never signals. Billing reads are never watched. The Owner's banner re-reads billing only when standing moves into `full` or `read_only`. The overlay is a sibling of the shell, so the open page stays mounted.
- **The support panel adds no power.** It uses `GET /support-grants`, approve (with a step-up) and revoke as they are. While the company is read only, TenantGuard refuses both writes, so the panel hides them and says why.
- **The demo has no life cycle.** Standing is always `full` and billing has no notice, as in the demo console.

## Decisions and why
**Safe options.** Each one is recorded in docs/blueprint-delta.md, ADR 0054 and the spec's "Safer than the outline (part 4)" (the delta and the ADR in stage 5).

1. **Standing reveals only TenantGuard's view, the same for every member.** Five words about the session's own company, which the session learns from TenantGuard's refusals anyway. No billing reason, date, plan or maintenance reason, and no Owner flag: disabling a person writes only the company database, so a disabled former Owner keeps `owner` in the control `member` row, and confirming an active Owner needs the company database.
2. **Standing mirrors TenantGuard's refusals, codes, messages and order** in a class-level guard, so a handler added to that controller later inherits it (ADR 0052's reasoning). The guard copies TenantGuard's private `hostProduct` helper, because core can't change. It opens no company database (lint, S-15, S-16), and a metadata allow-list pins every session-only handler (S-21).
3. **One locked, maintenance and unavailable screen for everyone,** with the API's own text and no reason or dates, the Owner included (owner question 21).
4. **No switch on standing.** It is how the shell shows TenantGuard's own refusals, like `/auth/context`. `settings.billing` governs the page, its menu item and the banner.
5. **`GET /billing` checks the switch before the Owner:** 404 for everyone while it is off (CLAUDE.md rule 13).
6. **No prices, ids, overrides or payment details.** The view's row type has no price, and a planted price is checked. Prices are open and seeded rows are `0` (owner question 22).
7. **"Current period ends", never "paid through",** because nothing records a payment (owner questions 7 and 23).
8. **No banner for anyone but the Owner** (owner question 24) **and no trial banner** (owner question 25). The Owner's overdue banner starts on the first overdue day of the 14-day grace, which is more notice than blueprint p23's "after the grace", with no extra exposure.
9. **Dates come from `companyPhase` itself, with an exact horizon:** the latest of now, the status change and every row's end, plus the sum of every `LIFECYCLE_DAYS` value plus one day. After it every ladder is on its last step. The first plan's 400-day constant missed yearly periods (critic C4).
10. **Deny by default on the web.** An unknown standing answer shows "Not available right now". A failed standing read leaves the decision to the API's guard on each request.
11. **The overlay never remounts the open screen** (no wrapper around the shell), sits above any open dialog, traps focus and gives it back. The command palette pauses while it shows (critic C2 and should 10).
12. **No request loops** (critic C1).
13. **The support panel adds no power:** approve needs a step-up because the API does, revoke needs none, there is no CSV of reasons, and the copy says support can't see data yet.
14. **Read-only support decisions** (the deviation; critic C3). The spec's "revokes at any time" can't hold: approve and revoke are writes, which TenantGuard refuses with 403 `company_read_only` while the company is read only. The panel hides both actions then and says "Support access can't be changed while your company's account is read only. Requests end on their own at the time shown." Allowing it would need a session-only route that writes control rows, or a TenantGuard change (owner question 26).
15. **No reads are audited,** and both new routes send `Cache-Control: no-store`.
16. **The demo has no life cycle** (critic C5): its period ends on the first of next month at midnight UTC, so a real clock would show a false "Payment overdue" on the last evening of a month in US time zones. It uses the same messages and Owner rule as the API.
17. **e2e state:** only Summit's maintenance flag and period dates change. They are snapshotted, restored, and checked equal afterwards. Global setup moves a stale or crashed Summit toward full use only, for slug `summit` only, and logs what it changed. The test requester is a "Test Support Agent" user who can't sign in, not a seeded Summit person.

**Smaller choices:**
- **A new ADR number, 0054.** ADR 0052 says later parts add sections to it. This part adds a session-only route outside /auth and /platform and a new feature key, so it takes 0054, as part 3 took 0053. ADR 0030's session-only list gets a "Changed by ADR 0054" line.
- **A `billing` module, not `platform`.** The two routes are the company's side. `modules/platform` keeps only the platform guard's routes.
- **`settings.billing` has status `demo`,** like every key that moved to the API with demo parity, and no permission key: the page is the Owner's only, like support access. The menu gains an `ownerOnly` flag that the menu, the page gate, the palette and the access preview all read through one `itemAllows` rule.
- **The support panel has no switch of its own.** It sits under `settings.users`, the page it is on. `/support-grants` has no switch, which is pre-existing, like the users routes.
- **The banner is hidden on /settings/billing,** where the page shows the same notice, so it is never shown twice.
- **No "Choose another company" on the blocked screen** (the critic's should 12, not taken). Api mode has no company chooser route the screen could send people to, and the shell's switcher is the demo presenter's. The screen keeps Sign out. A follow-up.
- **`[skip ci]`:** stage commits may carry it, but the head commit never does, so `verify` and `e2e` run when the PR is marked ready.

**The code was checked against the plan.** No contradiction was found at the plan stage. Any one found while building takes the safer reading and is noted for the docs stage.

## Owner questions (new in part 4; earlier ones still stand)
These are numbers 21 to 33 in docs/specs/platform-admin.md, "Waiting for the owner". Questions 1 (the admin host), 2 (using a support grant) and 7 (billing) stay open.

21. **Should a locked or maintenance company's Owner see why, and until when?** It needs an Owner check without the company database, or a TenantGuard change. Taken: no; one screen with the API's text for everyone.
22. **Prices on the Billing page?** Taken: not shown while prices are open.
23. **"Paid through" or "current period ends"?** It depends on question 7. Taken: "Current period ends".
24. **A read-only notice for every member?** Taken: the Owner only.
25. **A trial-ending banner?** Taken: none.
26. **Should the Owner of a read-only or locked company still approve or revoke support access?**
    - TenantGuard refuses writes when the company is read only, and everything when it is locked.
    - Allowing it needs a session-only route that writes control rows, or a TenantGuard change.
    - Taken: read only means the list only, with no actions; locked means nothing. Grants open nothing yet.
27. **Confirm the new key `settings.billing`:** status `demo`, the Owner only with no permission key, and the support panel under `settings.users`. The /feature-change step-2 impact summary is in the PR body and ADR 0054.
28. **A contact address or link for "contact us".** It needs the brand and domain.
29. **Should revoking need a step-up?** Taken: no; the API is unchanged.
30. **Seats in use on the Billing page?** They live in the company database. Taken: a link to Users.
31. **Should an Owner shorten an approved grant, or see who approved it?** Taken: no API change.
32. **May platform admins ask for access to a company whose Owner can't answer** (read only or locked)? Taken: unchanged. Requests are allowed, open nothing and expire.
33. **Self-approval.** A person who is both a platform admin and a company's Owner can approve their own request: the approve route doesn't compare the approver with the requester, and `platform-support.spec.ts` sets up exactly such a person for Summit. Taken: unchanged, because grants open nothing. It must be refused before grant use is built (question 2).

## Outcome
Draft PR #38 (`feat/billing-company-standing` into `main`). Stages 0 to 4 are committed with `[skip ci]` and pushed. The docs commit carries no `[skip ci]`, so the draft gets its first `fast` run; `verify` and `e2e` run when the PR is marked ready, and they need a head commit without `[skip ci]`.

| Stage | Commit | What |
| --- | --- | --- |
| 0, plan | `0e00ad5` | The part 4 spec section with acceptance criteria 40 to 63, owner questions 21 to 33, this log, the draft PR |
| 1, shared | `66330ac` | The five standing states and the screens' copy, `lifecycle-dates.ts`, the two `company-lifecycle.ts` exports, the Owner's billing view and notice, the support decisions and messages, the types, `settings.billing` with its docs/FEATURES.md row, unit tests |
| 2, API | `3b0b7a7` | `modules/billing`: `StandingMemberGuard`, `GET /company/standing`, `GET /billing`, `BillingFacts`; the lint blocks; the support-grant service on the shared messages; S-1 to S-21, B-1 to B-13 and the guard unit test |
| 3, web | `9a9b1f9` | The server standing read, `StandingGate` and the overlay, the three screens, the standing watch, the Owner's banner, /settings/billing with `ownerOnly` and `itemAllows`, the Support access panel, the ApiClient blocks and DemoStore, web unit tests |
| 4, tests | `8f22ac9` | The db test helpers and their test, the demo `billing.spec.ts`, /settings/billing in `screens.ts`, the api-mode `company-standing.spec.ts`, global setup |
| 4, checks | none | Every integration, typecheck and browser run passed first time, so nothing changed |
| 5, docs | the commit that adds this section | ADR 0054, the delta row, api-contract, the spec as built, docs/FEATURES.md (the `settings.users` note), the product spec, the users spec, notes in ADRs 0030, 0033, 0052 and 0053 |

`git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy` stayed empty after every stage. No table, migration or dependency changed.

## Decisions taken during the build
Each is in ADR 0054 ("Safest options taken" and "Smaller choices made while building"), the spec's "As built (part 4)" and the top row of docs/blueprint-delta.md. The planned ones are under "Decisions and why" above.

**Safer than the plan:**
- **Unreadable values deny or say less** (shared): an unknown notice reason reads as the plain "Read only" notice; the date helpers skip a moment that can't be read instead of throwing; "every counted row is a trial" needs at least one row; `companyBillingView` copies only `userLimit` and `branchLimit`.
- **DemoStore's billing refuses** with "That company does not exist." when the open company can't be found, instead of asserting it exists.
- **The tests check more:** the guard's unit test shows it looks up only the session's company and lets a member through in every state; S-16 shows a company route does open one pool; S-21 also checks every /platform handler is session-only and that `BillingController` has no class guards.
- **Two JSDoc lines** in `support-grants.service.ts` that said "revokes at any time" now say TenantGuard refuses both decisions while the company is read only (no behaviour change).

**Other choices:**
- **Shared API test helpers** in `apps/api/test/support/company-facts.ts` (not named in the plan), so the two integration files don't repeat them; an `afterEach` reset instead of a per-case `finally`.
- **B-12 is checked in the `billing()` helper** on every Owner read, and B-5 is split into B-5a to B-5h. In B-13 a second, enrolled Owner revokes, and the read-only case sends no step-up.
- **`overlayState` replaces the plan's `gateView`;** `UnavailablePanel` takes `onSignOut`; no effects with refs (the banner's counter and StandingGate's new server answer are adjusted during render, the re-check is made once with `useState`).
- **The palette closes for good** when the company becomes blocked.
- **The support panel re-reads by bumping a counter,** not `query.retry()`, and focus lands on the "Support access" heading after a decision. Approve's error is caught inside `onConfirm`; Revoke has its own confirm dialog.
- **Layout:** a narrower Reason column (`min-w-48 max-w-sm`), so Actions fits at 900 px; the standing title is `text-xl sm:text-2xl` at 375 px.
- **Two period texts:** "Current period: {start} to {end}" on the plan line and "Current period ends {end}" as its standing.
- **The PR #37 overlap:** the part 4 blocks in `contract.ts`, `api-methods.ts` and `store.ts` keep their own imports, checked against #37's diff from the git objects only. `pageList` in `products/pages.ts` will conflict on neighbouring lines, as the plan expects.
- **The session log's time** is 1515, from the task, not the plan's 1345.
- **This commit carries no `[skip ci]`,** following the plan's stage 5 ("the head; no `[skip ci]`") over the task's general git step, as every earlier stage report asked.

**The plan and the code agreed.** No contradiction was found at any stage, and no product bug was found by the browser runs.

## Commands run
Heavy runs went through the scratchpad lock, one at a time; logs are in the scratchpad's `platform4/logs` folder. Ports 3000 and 4000 were free before and after every dev server and browser run.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git fetch origin`; `gh pr create --draft`; `gh pr view 38` | origin/main still `c763938`; PR #38, draft and open |
| 1 | shared vitest on the six planned files and `access-rules.test.ts` | 148 passed |
| 1 | `pnpm --filter @workspace/shared exec vitest run` | 838 passed in 60 files |
| 1 | shared lint; Prettier on packages/shared | clean; 4 files formatted, then clean |
| 1 | `pnpm -s typecheck --force` | 6 of 6 tasks passed |
| 2 | API unit `company-standing-guard.test.ts`; `tsc --noEmit` in apps/api | 7 passed; clean |
| 2 | API integration, one file at a time: `company-standing.int`, `billing.int`, `isolation.int`, `permissions.int`, `users.int`, `platform.int`, `platform-support.int` | 21, 20, 15, 25, 17, 19 and 10 passed |
| 2 | `pnpm --filter api test`; `pnpm --filter api lint`; Prettier on apps/api | 79 passed in 14 files; clean; clean |
| 2 | lint probe: `zz-probe.ts`, `company-standing.zz-probe.ts`, and a third probe for the inherited rules | 2, 3 and 2 `no-restricted-imports` errors, as expected; all deleted, tree clean |
| 2 | `git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy`; `pnpm -s typecheck --force` | empty; 6 of 6 passed |
| 3 | `pnpm --filter web exec vitest run` | 108 passed in 9 files (company-standing 41, demo-billing-support 7) |
| 3 | `pnpm --filter web lint`; `pnpm --filter web typecheck`; Prettier on apps/web; `pnpm -s typecheck --force` | clean; passed; clean; 6 of 6 passed |
| 3 | demo dev server, driven by hand at 375 and 1440 px, light and dark | /settings/billing and the Support access panel as specified; approve and revoke with the right toasts and focus; the manager's NoAccess; Harbor's "HR Standard"; ⌘K lists Billing; no console warnings; server stopped |
| 4 | db `standing-test-helpers.int`; db lint, typecheck and unit tests | 4 passed; clean; 18 passed in 5 files |
| 4 | shared `features.test.ts`; web `tsc --noEmit` and ESLint on the e2e folders; Prettier | 7 passed; clean; clean |
| 4 checks | API integration `company-standing.int`, `billing.int`, `isolation.int`, `users.int`, `platform-support.int`; db `standing-test-helpers.int` | 21, 20, 15, 17, 10 and 4 passed |
| 4 checks | `pnpm -s typecheck --force` | 6 of 6 passed |
| 4 checks | the plan's demo e2e: demo build, then three chunks on one worker | 74 passed (15 Flooring specs, 8 a11y, console and responsive for the two pages, 51 HR) |
| 4 checks | the plan's api-mode e2e: both builds, then company-standing, login, platform-admin, platform-support and users | 14 passed (2, 6, 2, 1 and 3) |
| 4 checks | `company-standing.spec.ts` again on the same builds | 2 passed; global setup printed no reset line |
| 4 checks | Summit before and after, by psql: `tenants` status, maintenance and status change; the subscription row's period and status; open grants; the test agent | all equal except `updated_at` on both rows (the restore helpers bump it); 0 open grants; the agent removed |
| 5 | shared vitest on `company-standing`, `lifecycle-dates`, `company-billing`, `support-grants`, `company-lifecycle` and `features` tests | 133 passed (8, 35, 45, 31, 7 and 7) |
| 5 | web vitest on `company-standing.test.tsx` and `demo-billing-support.test.ts` | 48 passed |
| 5 | `grep -n "settings.billing"` over docs/FEATURES.md and features.ts; `features.test.ts` after the `settings.users` note | one row and one key; 7 passed |
| 5 | `git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy` | empty |

Prettier ignores `*.md` in this repository, so the docs stage has no formatter run.

## Left
- **Before ready (orchestrating session):** the full `pnpm lint`, `pnpm -s typecheck --force`, `pnpm test` (with `test:hooks`) and `pnpm test:api` on the head; `/review`; a fresh security-reviewer (the plan's focus list: the standing route's exposure, the empty core diff, the session-only allow-list and class guard, `GET /billing`'s switch-then-Owner order and what it never returns, the approve step-up and the read-only hiding, loop freedom, the e2e helpers being test-only), its summary posted with `gh pr review 38 --comment --body-file`; then ready, and `verify` and `e2e` green on a head without `[skip ci]` before the self-merge.
- **STATUS and BRANCHES:** by the orchestrating session: "Next three tasks" 2 (part 4 done, a reduced part 2 next), a Done entry, the residual risks of ADR 0054 as follow-ups, owner questions 21 to 33 under Blockers, the PR #38 row. The STATUS note that the console says "in Settings" while the web has no Owner screen is closed by this part.
- **The PR body:** its "Screenshots" section still says "To come with the web stage", and the stage 3 shots are only in the scratchpad.
- **Not checked by eye:** the real overlay, the full-page maintenance and suspended screens and the banner in api mode, at 375 and 1440 px in both themes. The api-mode spec asserts them (the overlay at 1440 px, the maintenance page at 375 px with no sideways scroll); the demo can't show them.
- **Doubtful or open:**
  - `since` for `payment_lapsed` with a mixed set names a trial's end as "Your plan's period ended on"; accepted as the spec says, recorded as a residual risk;
  - a `ready` database row whose connection string can't be decrypted gives company routes a 500 `internal_error`, not 503 `company_unavailable` (pre-existing, core/tenancy), while standing reads `full`;
  - the refusals of both new routes carry no `Cache-Control: no-store` (only the 200s do);
  - merging with PR #37: `products/pages.ts` (`pageList`), and the top rows of docs/blueprint-delta.md, docs/api-contract.md, docs/FEATURES.md, STATUS and BRANCHES; whichever lands second keeps both and re-runs the web unit tests, the typecheck and both e2e projects.
- **Next:** a reduced part 2 (`feat/platform-manual-billing`: plans as data, suspend, reinstate and cancel), as STATUS's queue says.

## Review round 1
One finding, should fix, confirmed by a skeptic: after stage 3, `canOpenPage` used the private `bestRule` and `itemAllows`, so the exported `pagePermissions` in `apps/web/src/products/pages.ts` had no caller left. It also gave the wrong rule for an Owner-only page: `[]` for /settings/billing, because it dropped `ownerOnly`.
- **Fixed:** `pagePermissions` is removed, and its JSDoc on pages without a rule moved to `bestRule`. No behaviour changes, because nothing called it.
- **Test:** a new web unit case in `company-standing.test.tsx` checks that `/` and `/outbox` open for someone with no permissions on both hosts, while `/settings/outbox` does not.
- **Docs:** settings-and-permissions.md item 20 names `canOpenPage` and `itemAllows` (the Owner for an `ownerOnly` page, otherwise any key in `anyOf`). notifications.md says `/outbox` has no page rule, so `canOpenPage` lets everyone open it. ADR 0054's `ownerOnly` bullet records the removal. The delta row doesn't change, because behaviour doesn't.
- **Run, through the lock:** `pnpm --filter web exec vitest run` passed 109 tests in 9 files. `pnpm --filter web typecheck` and `pnpm --filter web lint` were clean. Prettier on the two changed files was clean. `git grep pagePermissions` now finds only the ADR line that records the removal.
