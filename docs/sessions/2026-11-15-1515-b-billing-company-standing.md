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
