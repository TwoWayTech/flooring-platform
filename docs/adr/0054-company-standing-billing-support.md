# ADR 0054: Company standing, the Owner's billing page and support-access panel (platform admin part 4)

- **Status:** accepted, 2026-11-15. Built overnight on `feat/billing-company-standing` (PR #38) under the owner's rule for this queue: follow the spec as the approved behaviour, deviate only in the safer direction (less exposure, deny by default, refuse what can't be done correctly), record each deviation in docs/blueprint-delta.md and here, and defer what needs the owner. The safer deviations, the /feature-change impact summary and the questions under "For the owner" are open for the owner's review.
- **Context:**
  - ADR 0052, "Later parts", part 4: `GET /company/standing` with its own membership check; the maintenance and suspended screens; the Owner's banner; a read-only billing page; the Owner's support-access panel, saying support can't see data yet. ADR 0052 says later parts add sections to it. This part takes a new number, as part 3 did, because it adds a session-only route outside /auth and /platform (a change to ADR 0030's list) and a new feature key, `settings.billing`.
  - ADR 0053, "Deferred": the Owner's support-access panel. Its residual risk "Approves it in Settings" pointed the console's admins at an Owner screen the web didn't have.
  - ADR 0033, "Consequences": "A dedicated 'under maintenance' and 'suspended' screen comes with the platform-admin screens." Until now the web showed TenantGuard's refusals as toasts and error cards only.
  - The behaviour is docs/specs/platform-admin.md, "Part 4: the company side", drafted as the first step of this run. As with parts 1 and 3, the P11 "stop for my approval" step could not happen overnight, and neither could the confirmation in step 2 of `.claude/commands/feature-change.md`.
  - Blueprint p7 role rule 6 (support access, approved by the Owner), p12 (the maintenance banner, a full-page screen since the owner's decision of 2026-11-13), p23 steps 4 and 5 (past due and the Owner's banner), p24 (plans and limits), p29 (support access; a company that paid and cancels is read only for 90 days) and p40 (suspended).
  - The code as it is at `c763938`:
    - TenantGuard refuses before any company handler runs: 503 `company_maintenance`, 503 `company_unavailable` and 403 `company_suspended`. So a company route can't answer in the very states the screens need;
    - `TenantDirectory.access` works out the phase from control rows, `PlanLimits.limitsOf` the limits, and the users module's `SupportGrantsService` already lists, approves and revokes for the Owner;
    - disabling a person writes only the company database's `user_profiles`, so a disabled former Owner keeps `owner` in the control `member` row.
  - The bounds of this run: no new or altered table, no migration, no new dependency, and no change at all in `apps/api/src/core/auth` or `apps/api/src/core/tenancy` (`git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy` is empty). Billing writes and using a support grant stay out.

## Decision

### Routes
docs/api-contract.md, "Company standing and billing (real build, ADR 0054)".

| Route | Access | Who | Step-up | Audit | Answer |
| --- | --- | --- | --- | --- | --- |
| `GET /company/standing` (new) | `@SessionOnly()`, with `StandingMemberGuard` at class level | Any member of the session's company, a disabled one included | No | None | `CompanyStanding` `{ state }`, `Cache-Control: no-store` |
| `GET /billing` (new) | A company route: SessionGuard, TenantGuard and PermissionGuard (`@AnyCompanyMember()`) unchanged, then the switch, then the Owner | The Owner | No | None | `CompanyBilling`, `Cache-Control: no-store` |
| `GET /support-grants` (unchanged) | A company route | The Owner | No | None | `CompanySupportGrant[]`, newest first, at most 100 |
| `POST /support-grants/:id/approve` (unchanged) | A company route | The Owner | Yes | `support.approved` and "Approved support access" | 204 |
| `POST /support-grants/:id/revoke` (unchanged) | A company route | The Owner | No | `support.revoked` and "Revoked support access" | 204 |

Both new routes live in a new module, `apps/api/src/modules/billing` (`BillingModule`, registered after `PlatformModule`): `CompanyStandingController` owns `company/standing` and `BillingController` owns `billing`. Neither takes a company id: the company is always the verified session's (`AuthSession.companyId`), and no path, query, body or header id is read.

### Standing (`modules/billing/company-standing.guard.ts`, `company-standing.controller.ts`; `packages/shared/src/platform/company-standing.ts`)
- **Why session-only.** Answering through TenantGuard would need a new access level or a bypass flag in core/tenancy. Instead the controller is `@SessionOnly()` at class level, owns one path, and carries `StandingMemberGuard` at class level, so a handler added to it later inherits the guard (the reasoning of ADR 0052). It is the only session-only route outside /auth and /platform.
- **`StandingMemberGuard`** takes only `TenantDirectory` and refuses in TenantGuard's order, with TenantGuard's own codes and words (`TENANCY_REFUSALS`):
  1. no open company in the session: 403 `company_required`;
  2. the open company is unknown or deleted (`TenantDirectory.access`): 403 `company_required`;
  3. the person is no longer a member (`TenantDirectory.isMember`): 403 `not_a_member`;
  4. the host product header names a product the company lacks: 403 `product_not_enabled`. A request without the header skips this step, as in TenantGuard.

  SessionGuard runs first, unchanged (401, `session_expired`, `mfa_enrolment_required`). If no session is attached the guard throws rather than lets the request through. It hands the checked company to the handler through `@MemberCompany()`, which also fails loudly without the guard. It copies TenantGuard's private `hostProduct` helper, because core can't change.
- **The answer** is `{ state }`, one of `full`, `read_only`, `locked`, `maintenance` and `unavailable`. The handler feeds TenantDirectory's own facts and predicates (`maintenanceMode`, `isDatabaseUsable`, `isReadOnly`, the phase) into the shared `companyStandingState`, which follows TenantGuard's order: maintenance, then unavailable, then locked, then read only, then full.
- **What it reveals:** the same five words to every member, about the session's own company, which the session learns from TenantGuard's refusals on any company route anyway. Never anything about billing (no reason, date, plan or status word), never the maintenance reason, and no Owner flag.
- **No company database:** the guard and the handler never build a TenantContext, never call TenantConnectionService and never open the company database. Lint enforces it (below), and S-15 and S-16 show it.
- **No audit and no switch:** it is a read, and session-only routes skip the AuditInterceptor. It is how the shell shows TenantGuard's own refusals, like `GET /auth/context`, so `settings.billing` doesn't touch it.

### Billing (`modules/billing/billing.controller.ts`, `billing.service.ts`, `billing-facts.ts`; `packages/shared/src/platform/company-billing.ts`, `permissions/lifecycle-dates.ts`)
- **Refusal order:** SessionGuard, TenantGuard and PermissionGuard unchanged (a read-only company may read, because this is a GET; a disabled person gets 403 `forbidden`); then `settings.billing` off gives 404 to everyone, the Owner included (`requireFeature`); then anyone but the Owner (`access.isOwner`, false for a disabled profile) gets 403 `forbidden`, "Only an Owner can see billing." (`BILLING_OWNER_ONLY_MESSAGE`); then a company deleted since the guard ran gets 403 `company_required`.
- **What it reads** (`BillingFacts`): control rows only, as the tables are. `tenants` (status and status change), `tenant_databases` (status, through a left join), every `tenant_subscriptions` row, deleted ones included, ordered by `created_at` then `id`, with its plan name and product key. These are the columns TenantDirectory reads for the phase, so the page and the guards agree (B-12 checks it on every Owner read). `price` goes only into the life-cycle facts, to tell a paid row from a trial, and never into the rows, whose type (`BillingRow`) has no price. The limits come from `PlanLimits.limitsOf`.
- **The answer, `CompanyBilling`:** `{ status, phase, subscriptions, limits, notice }`.
  - `subscriptions` are the live rows, each `{ planName, product, interval, currentPeriodStart, currentPeriodEnd, standing }`, with `standing` from `subscriptionStanding` (`current`, `overdue`, `past_due`, `trial`, `trial_ended`, `cancelled` or `unknown`);
  - `limits` is `{ userLimit, branchLimit }`, copied field by field, so nothing else reaches the answer;
  - `notice` is the Owner's `OwnerBillingNotice` or null: `payment_overdue` from the first overdue day of the 14-day grace or while past due, or `read_only` with a reason (`suspended`, `cancelled`, `payment_lapsed`, `trial_ended`, `database` or `account`) and its dates. For `payment_lapsed`, `since` is the latest counted paid row's end, so a trial that ended later is never named as the plan's period (final review); for `trial_ended` it is the latest counted row's end.
- **Never returned:** a price, a subscription id, a plan key, `userLimitOverride` or `branchLimitOverride`, a user id, seats in use, or payment details. B-6 plants a price of `12345.67` and checks that no such key appears at any depth.
- **The dates** (`phaseDates`, `phaseReachedAt`, `lifecycleHorizon`): `readOnlyFrom` and `lockedFrom` are the first moments at which `companyPhase` itself gives that phase or a stricter one, found by a binary search on whole milliseconds between now and an exact horizon. The horizon is the latest of now, the status change and every row's period end, plus the sum of every `LIFECYCLE_DAYS` value plus one day (165 days today). After it every ladder is on its last step; for fixed facts the phase only steps down; no period length is assumed, so yearly rows are covered; and there is no second copy of the ladder. `PHASE_RANK` and `countedSubscriptions` are now exported from `company-lifecycle.ts`, with no behaviour change, so nothing is copied.

### Support access (unchanged routes; `modules/users/support-grants.service.ts`, `packages/shared/src/platform/support-grants.ts`)
- **No behaviour change.** The service's view type becomes the shared `CompanySupportGrant` (`{ id, adminName, reason, requestedAt, expiresAt, status }`, no approver and no admin id), and its Owner-only and closed-grant messages come from packages/shared (`SUPPORT_OWNER_ONLY_MESSAGE`, `SUPPORT_CLOSED_MESSAGES`), byte for byte. `users.int.test.ts` passes unchanged. Two JSDoc lines that said "revokes at any time" now say TenantGuard refuses both decisions while the company is read only.
- **New shared rules** for the web and the demo: `supportGrantDecisionRefusal` (the API's order and messages) and `supportActions` (pending: approve and revoke; approved: revoke; revoked, expired or read only: none), plus `SUPPORT_READ_ONLY_MESSAGE`.

### Web (apps/web)
- **On a full page load** the (app) layout asks `GET /company/standing` on the server (`getServerStanding` in `lib/session/server.ts`), forwarding the host's product header so the answer equals the browser's. A blocking answer (`maintenance`, `unavailable`, `locked`) renders only the full-page screen (`CompanyUnavailable`), with no shell, menus or workspace. Otherwise the shell renders inside `StandingGate`. A 200 with an unknown state reads `unavailable`; any other status, or a network failure, gives no answer (`serverStandingOf`), and the API's guards still refuse every request. Demo mode never asks the server.
- **The standing watch** (`lib/api/standing-watch.ts`, `withStandingWatch`, a Proxy like `withSimulatedNetwork`): an ApiClient call that fails with an `HttpApiError` coded `company_maintenance`, `company_unavailable`, `company_suspended` or `company_read_only` signals `StandingGate` and rethrows the same error. `getCompanyStanding` and `getCompanyBilling` are never watched. The demo's errors are plain `ApiError`s, so they never signal.
- **`StandingGate`** (`features/standing/`) keeps the standing, takes a new server answer after `router.refresh()`, and re-reads on a signal through `createRecheck`: one read in flight plus one trailing, a failed read keeps what was known. A blocking state shows the overlay, a Radix `Dialog` from packages/ui with `role="alertdialog"`, rendered as a sibling of the shell with no wrapper, so the open page is never re-parented or remounted. Radix's modal layer gives the focus trap, `aria-hidden` on the rest, blocked outside pointer events, stacking above an open dialog and focus return. Escape and outside clicks don't close it; the command palette closes and its shortcut pauses. `overlayState` and `bannerReread` are the pure rules.
- **The three screens** (`STANDING_SCREENS` in packages/shared): "Under maintenance", "Not available right now" and "Account suspended", each with the API's own refusal text, Try again and Sign out, the same for every member, with no reason or dates.
- **The Owner's banner** (`OwnerBillingBanner`, `BillingNotice`, `billingNoticeText`): only with `settings.billing` on, for the Owner (`access.isOwner`, which follows View as), off /settings/billing, while the company isn't blocked and `GET /billing` gives a notice. It re-reads billing only when standing moves into `full` or `read_only` from another known state.
- **/settings/billing** (`features/settings/billing/billing-page.tsx`): the Owner's read-only page with the Account, Plan and Limits panels, the notice first, and no money anywhere. A read refused with a standing code asks `StandingGate` to re-check, because billing reads aren't watched.
- **`ownerOnly`:** menu items gain the flag, and one rule, `itemAllows(item, access)` in `products/index.ts`, now decides the settings nav and home, the command palette, the page gate (`canOpenPage`) and the access preview. An `ownerOnly` item needs `access.isOwner`, and its `anyOf` is empty, so no role can ever be given it. `pagePermissions`, which returned only a rule's `anyOf` and so dropped `ownerOnly`, had no caller left and is removed (review round 1), so no second page rule can disagree with `itemAllows`.
- **The Support access panel** (`features/settings/users/support-access-panel.tsx`) on Settings → Users, for the Owner only, under the users table: the requests, Approve through the step-up dialog, Revoke through a confirm dialog with no step-up, no CSV export. While standing is `read_only`, both actions are hidden and the panel says why. The copy says support can't see the company's data yet.
- **ApiClient:** `getCompanyStanding`, `getCompanyBilling`, `listSupportGrants`, `approveSupportGrant` and `revokeSupportGrant`, in one commented block of `contract.ts` and `api-methods.ts`, each with its own import, so PR #37's edits to the shared import lists merge cleanly. A grant id that isn't a UUID is never sent: the call rejects with the API's words for a closed grant.

### Demo (`lib/api/demo/company-standing.ts`, `platform-support.ts`, `store.ts`)
- **No life cycle,** as in the demo console: `getCompanyStanding()` always answers `{ state: "full" }`, and `getCompanyBilling()` shows the stand-in plan (`demoSubscription`) with standing `current`, phase `full` and no notice. It reads no clock, so the end of a month in UTC never shows a false "Payment overdue".
- **The same rules and messages as the API:** the switch first ("This feature is switched off."), then the Owner ("Only an Owner can see billing.", "Only an Owner can manage support access."). The Owner approves and revokes the console's requests (`demoOwnerGrantViews`, `demoGrantDecision`), each writing the company's audit entry and the console's platform row, as the API does.

### Lint (`apps/api/eslint.config.js`, not core)
- `src/modules/billing/**`: on top of the inherited rules, no `@workspace/db/company` and no `tenancy/tenant-connection.service` ("Billing reads the control database only (ADR 0054).").
- `src/modules/billing/company-standing.*.ts`: also no `tenancy/tenant-context` ("The standing route never sees a TenantContext (ADR 0054).").
- Checked with temporary probe files: 2 and 3 `no-restricted-imports` errors as expected, and the inherited `openCompanyDb` and job-tenant rules still apply (2 errors). The probes were deleted.
- `apps/web/eslint.config.mjs` (final review): `src/**` may not import `@workspace/db/testing` or `@workspace/db/seed`, mirroring apps/api's `@workspace/db/testing` rule; `tests/**` may. The `src/**` block repeats the fixture pattern, because flat config replaces a rule's options, and `src/lib/api/demo/**` keeps fixtures but not those two. Probes gave 3 errors under `src/features`, 1 under `src/lib/api/demo` and none under `tests/`, and were deleted.

## Safest options taken (also in docs/blueprint-delta.md)
1. **Standing reveals only TenantGuard's view, the same for every member:** five words about the session's own company, nothing about billing, no maintenance reason and no Owner flag (a disabled former Owner keeps `owner` in the control `member` row, and an active-Owner check needs the company database).
2. **Standing mirrors TenantGuard's refusals, codes, messages and order** in a class-level guard. It opens no company database (lint, S-15, S-16), changes nothing in core, and an allow-list pins every session-only handler (S-21).
3. **One locked, maintenance and unavailable screen for everyone,** the Owner included, with the API's text and no reason or dates (question 21).
4. **No switch on standing.** `settings.billing` governs the page, its menu item and the banner.
5. **`GET /billing` checks the switch before the Owner:** 404 for everyone while it is off (CLAUDE.md rule 13).
6. **No prices, ids, plan keys, overrides or payment details.** The row type can't carry a price, and a planted-price test checks it (question 22).
7. **"Current period ends", never "paid through",** because nothing records a payment (questions 7 and 23).
8. **No banner for anyone but the Owner** (question 24) **and no trial banner** (question 25). The Owner's overdue banner starts on the first overdue day of the 14-day grace, which is more notice than blueprint p23's "after the grace", with no extra exposure.
9. **Dates come from `companyPhase` itself,** with an exact horizon. There is no second copy of the ladder, and the copy never promises the account stays read only.
10. **Deny by default on the web:** an unknown standing answer shows "Not available right now". A failed standing read leaves the decision to the API's guard on each request.
11. **The overlay never remounts the open screen,** sits above any open dialog, traps focus and gives it back. The palette pauses.
12. **No request loops:** only StandingGate reacts to signals, and only by reading standing, which never signals; billing reads never signal; the banner re-reads only on a standing transition.
13. **The support panel adds no power.** It uses the existing endpoints unchanged: approve needs a step-up because the API does, revoke needs none, there is no CSV of reasons, and the copy says support can't see data yet.
14. **No Owner decision while the company is read only (the deviation).** docs/specs/settings-users-access.md said the Owner "revokes at any time". Approve and revoke are writes, which TenantGuard refuses with 403 `company_read_only` while the company is read only, so the panel hides both actions then and says why ("Support access can't be changed while your company's account is read only. Requests end on their own at the time shown."), instead of offering them only to fail. A locked company opens no screen at all. Allowing it needs a session-only route that writes control rows, or a TenantGuard change (question 26).
15. **No reads are audited,** and both new routes send `Cache-Control: no-store` on their answers.
16. **The demo has no life cycle** (its period ends at midnight UTC on the first of the month, so a real clock would show a false "Payment overdue" on the last evening of a month in US time zones), and it uses the same messages and Owner rule as the API.
17. **The api-mode e2e touches only Summit's maintenance flag and period dates.** They are snapshotted, restored in a `finally` after each step, and asserted equal in `afterAll`. Global setup moves a stale or crashed Summit toward full use only, refuses any slug but `summit`, and logs what it changed. Every standing helper that names a company (`readStandingFacts`, `setMaintenance`, `setPeriodEnd`, `insertSupportGrant`, `clearTestStanding`) refuses any slug but `summit` through one private check, and `restoreStandingFacts` refuses another company's snapshot and updates only that company's rows (final review). The test requester is a "Test Support Agent" user who can't sign in, not a seeded Summit person.

**Safer still, settled while building:**
- **Unreadable values deny or say less.** `billingNoticeText` treats an unknown reason as the plain "Read only" notice; the date helpers skip a moment that can't be read instead of throwing; "every counted row is a trial" needs at least one row; `companyBillingView` copies only `userLimit` and `branchLimit`.
- **DemoStore's billing refuses** with "That company does not exist." when the open company can't be found, instead of asserting it exists.
- **The guard unit test** also shows that the guard looks up only the session's company and lets a member through in every company state (the handler answers with the state), and S-21 also checks that every /platform handler is session-only and that `BillingController` has no class guards.

## Kept as the spec says (not safety)
- Billing is the Owner's only, with no permission key; standing is for every member.
- Approve keeps its step-up from the last 5 minutes; revoke has none (question 29).
- The 14-day grace, the read-only windows and the lock come from the existing ladder (ADR 0033), unchanged.
- The banner's copy, the page's panels and the screens' titles and texts are the spec's.
- No new audit action: approve and revoke keep their two rows each.

## Smaller choices made while building (not safety)
- **A `billing` module, not `platform`.** The two routes are the company's side; `modules/platform` keeps only the platform guard's routes.
- **Shared API test helpers** in `apps/api/test/support/company-facts.ts`, so the two integration files don't repeat the subscription and status helpers; an `afterEach` reset restores the company even when a test fails.
- **B-12 is a check inside the `billing()` test helper,** on every Owner read (`phase` equals `TenantDirectory.access(C).phase`), not a test of its own. B-5 is split into B-5a to B-5h.
- **B-13 revokes with a second, enrolled Owner,** because the first Owner had to step up to approve; the read-only case sends no step-up, since TenantGuard refuses first.
- **`overlayState`** (the blocking state or null) replaces the plan's `gateView`; `UnavailablePanel` takes an `onSignOut` prop so it stays pure and unit-testable.
- **No effects with refs** (lint): the banner's re-read counter and StandingGate's new server answer are adjusted during render; the re-check is created once with `useState`.
- **The palette closes for good** when the company becomes blocked, so it can't reopen on its own when the overlay closes.
- **The support panel re-reads by bumping a counter,** not `query.retry()`, which would blank the table and drop focus; after a decision focus lands on the "Support access" heading, because the decision can remove the button that opened the dialog. Approve's error is caught inside `onConfirm` and shown as a toast.
- **Layout:** the support table's Reason column is `min-w-48 max-w-sm`, so the Actions column fits at 900 px with the two buttons stacked; the standing screen's title is `text-xl sm:text-2xl`, so "Under maintenance" fits at 375 px.
- **Two period texts:** the plan line reads "Current period: {start} to {end}", and the standing reads "Current period ends {end}".
- **`SUPPORT_CLOSED_MESSAGES`** is a typed `Readonly<Record<…>>`, with the same strings as the API's. `BlockingStandingState` and `SupportGrantStep` type the screens and the decisions.

## Deferred, not invented
- **Using a support grant** to open a company read-only (ADR 0034, ADR 0052 question 2): a tenancy change. The panel says support can't see data yet.
- **Billing writes:** subscriptions, payments, invoices, period corrections and prices (ADR 0052, "For the owner" 7; part 2 builds plans and status actions only).
- **The admin host** (question 1).
- **Support decisions in a read-only company** (question 26).
- **"Choose another company"** on the blocked screen: api mode has no company chooser route to send people to, and the shell's switcher is the demo presenter's. The screen keeps Sign out (a follow-up).
- **Seats in use on the Billing page:** they live in the company database; the page links to Users (question 30).

## The /feature-change impact summary (step 2, for the owner to confirm on review)
Step 2 of `.claude/commands/feature-change.md` asks the owner to confirm before anything changes. That couldn't happen overnight, so the summary is here and in the PR body, and the key is owner question 27.
- **Feature keys:**
  - **New `settings.billing`:** both products, the Platform module, status `demo` (like every key that moved to the API with demo parity), `enabled: true`, screens `/settings/billing`, no permission key (the Owner only). It sits after `settings.audit` and before `admin.access` in `packages/shared/src/features.ts` and docs/FEATURES.md, kept in sync by `features.test.ts`.
  - **`settings.users` changes, not its key:** its row gains a note for the Owner's Support access panel, which has no key of its own. The switch hides the panel only; `/support-grants` has no switch (pre-existing, like the users routes).
  - No other key changes. `admin.access` is untouched.
- **Screens:** new /settings/billing on both hosts; Settings → Users gains the Support access panel; the (app) layout gains the standing screens and the overlay; the app shell gains the Owner's banner.
- **Menus and the palette:** one new Settings item, "Billing" (Company group, after Company profile, credit-card icon), with the new `ownerOnly` flag. `itemAllows` now decides the settings nav, the settings home, the command palette, the page gate and the access preview; `canOpenPage` for every other settings page is unchanged for the Owner and the manager (web unit test).
- **Permissions:** no new key; the catalog and the default roles are unchanged. The API checks the Owner.
- **Data:** new shared types (`CompanyStanding`, `CompanyBilling`, `CompanyBillingSubscription`, `OwnerBillingNotice`, `CompanySupportGrant` and their parts); five ApiClient methods and their DemoStore methods; no fixtures change and no `pnpm fixtures`.
- **When it is off:** `GET /billing` answers 404 to everyone, before the Owner check; the menu item, its settings-home card and its palette entry go, and the page shows "This feature is switched off in this demo."; DemoStore refuses with "This feature is switched off."; the banner goes. The standing screens, the overlay and `GET /company/standing` stay, because they show TenantGuard's own refusals.
- **Tests:** new shared unit tests, `company-standing.int.test.ts`, `billing.int.test.ts`, a guard unit test, web unit tests, the demo `billing.spec.ts` and the api-mode `company-standing.spec.ts`; `/settings/billing` joins `tests/e2e/screens.ts` (axe, console, 375 px) on both hosts; `features.test.ts` gains the route.
- **What stays as it is:** every existing route, guard and refusal; the support-grant routes (only their messages move to packages/shared); TenantGuard, PermissionGuard and the global pipeline; core/auth and core/tenancy.

## For the owner
Also in docs/specs/platform-admin.md, "Waiting for the owner", numbers 21 to 33. Questions 1 (the admin host), 2 (using a support grant) and 7 (billing) of ADR 0052 stay open, and ADR 0053's still stand.

21. **Why a company is locked or in maintenance:** should its Owner see why, and until when? It needs an Owner check without the company database, or a TenantGuard change. Taken: no; one screen with the API's text for everyone.
22. **Prices on the Billing page.** Taken: not shown while prices are open.
23. **"Paid through" or "current period ends"** (depends on question 7). Taken: "Current period ends".
24. **A read-only notice for every member.** Taken: the Owner only.
25. **A trial-ending banner.** Taken: none.
26. **Support decisions in a read-only or locked company.** TenantGuard refuses writes when the company is read only and everything when it is locked; allowing them needs a session-only route that writes control rows, or a TenantGuard change. Taken: read only means the list only, with no actions; locked means nothing. Grants open nothing yet.
27. **The new key `settings.billing`:** confirm status `demo`, the Owner only with no permission key, and the panel under `settings.users`. The impact summary is above.
28. **"Contact us":** a contact address or link, which needs the brand and domain.
29. **A step-up on revoke.** Taken: no; the API is unchanged.
30. **Seats in use on the Billing page.** Taken: a link to Users.
31. **Shortening an approved grant, or seeing who approved it.** Taken: no API change.
32. **Requests to a company whose Owner can't answer** (read only or locked). Taken: unchanged; requests are allowed, open nothing and expire.
33. **Self-approval.** A person who is both a platform admin and a company's Owner can approve their own request: `support-grants.service.ts` doesn't compare the approver with the requester, and `platform-support.spec.ts` sets up exactly such a person for Summit. Taken: unchanged, because grants open nothing. It must be refused before grant use is built (question 2).

## Residual risks
- **Standing and guard drift.** `companyStandingState`'s order restates TenantGuard's. Only the integration tests (S-7 to S-14 and S-18) catch drift.
- **Copy drift.** The three screens' texts repeat API strings in packages/shared; S-20 pins them equal.
- **No MFA backstop on standing.** Session-only routes skip PermissionGuard's MFA check for roles that need MFA (SessionGuard's `mfa_enrolment_required` still applies, S-6). The exposure is the five-word state.
- **Disabled members can read standing.** Exposure-neutral: on any company route TenantGuard answers them before PermissionGuard's disabled check.
- **The api-mode Owner flag comes from the demo fixture match** (`toCompanySession`), because the shell still reads DemoStore for the workspace. The API decides either way: a mismatch gives a silent 403, so no banner and no panel. This is the existing "the shell reads DemoStore" follow-up.
- **The watch only sees calls through the ApiClient** (CLAUDE.md rule 1). The billing page re-checks for itself.
- **Request patterns:** one standing read per full page load for everyone, plus one `GET /billing` for the Owner; the banner re-reads only on standing transitions, and on DemoStore emits like every api-backed query; signals coalesce to at most one standing read in flight and one trailing.
- **A database that control says is `ready` but can't be used.** Standing reads `full`, so there is no overlay, and company routes fail with their own errors and error cards. In S-15 a stored connection string that can't be decrypted gives 500 `internal_error` (logged as "Unknown encrypted value format"), not 503 `company_unavailable`: existing TenantConnectionService behaviour in core/tenancy, unchanged here. A 500 is not a standing code, so there is no loop.
- **Refusals don't carry `Cache-Control: no-store`.** Only the 200 answers of both new routes send it (`@Header` applies to the handler's answer). A refusal holds no company data.
- **Read-only support decisions** (question 26): the Owner can't end an approval while the company is read only. Grants open nothing yet.
- **Self-approval** (question 33).
- **`settings.users` off hides the panel, but `/support-grants` has no switch** (pre-existing, like the users routes).
- **Dates use the browser's time zone,** as elsewhere. The demo's period ends at midnight UTC, so in US time zones its end shows as the day before.
- **A local database seeded more than a month ago** shows Summit as overdue, and as locked after 44 days. The api-mode e2e's global setup refreshes it, for e2e only.
- **A killed e2e run** can leave Summit in maintenance (`move`) or lapsed until the next global setup. The restore helpers bump `updated_at` on Summit's `tenants` row and its subscription row on every run; it is not a standing fact.
- **The audit rows are append-only:** each api-mode e2e run adds `support.approved` and `support.revoked` rows to `platform_audit_log` and to Summit's `audit_log`.
- **The overlay re-check is event-driven, with no polling.** A company that leaves maintenance stays behind the overlay until Try again or the next refused request.
- **The demo can't show the screens, the overlay or the banner.** The api-mode e2e asserts them (the overlay at 1440 px, the maintenance page at 375 px with no sideways scroll), but nobody has looked at them by eye at 375 and 1440 px in both themes.
- **Members of several companies** get only Try again and Sign out on a blocked screen (follow-up).

## Consequences
- **No schema, dependency or core change:** no table, column, index, trigger or migration, and no dependency. Nothing in `apps/api/src/core/auth` or `core/tenancy` changes, not even a comment; part 4 only imports `TENANCY_REFUSALS`, `TenantDirectory`, `isDatabaseUsable`, `isReadOnly`, the `CompanyAccess` and `AuthSession` types, `SessionOnly`, and in tests `companyMaintenance()` and `companyUnavailable()`. packages/db gains test-only helpers.
- **ADR 0030's session-only list grows:** `GET /company/standing` is session-only behind its own class-level membership guard on control rows. The isolation test's session-only map covers it through the company-route branch, code included.
- **Paths touched:** `packages/shared/src/platform/company-standing.ts`, `company-billing.ts`, `support-grants.ts`, `permissions/lifecycle-dates.ts`, `permissions/company-lifecycle.ts` (two exports), `types/platform.ts`, `index.ts` and `features.ts`; `apps/api/src/modules/billing/*`, `app.module.ts`, `eslint.config.js` and `modules/users/support-grants.service.ts`; `apps/web/src/app/(app)/layout.tsx`, `app/(app)/settings/billing/page.tsx`, `components/shell/app-shell.tsx`, `components/access-preview.tsx`, `features/standing/*`, `features/settings/billing/*`, `features/settings/users/support-access-panel.tsx` and `users-page.tsx`, `lib/api/*` (the contract, the HTTP methods, the watch, the index and the demo), `lib/session/server.ts` and `server-standing.ts`, `products/*`, and `apps/web/eslint.config.mjs`; `packages/db/src/testing.ts`.
- **The docs changed:** docs/specs/platform-admin.md (part 4 in full, as built, and part 3's text where part 4 changes it), docs/api-contract.md (Tenancy, the new section, the support rows, the method tables, the standing watch), docs/FEATURES.md (the new `settings.billing` row and the `settings.users` note), docs/product-spec/settings-and-permissions.md, docs/specs/settings-users-access.md ("Support access"), ADR 0030, 0033, 0052 and 0053 (notes pointing here) and docs/blueprint-delta.md. docs/data-model.md is unchanged.
- **Tests:**
  - packages/shared: new `test/company-standing.test.ts` (8 cases: TenantGuard's order over all 16 combinations, the wire reader), `test/lifecycle-dates.test.ts` (35: the dates table to the millisecond, 500 seeded fact sets against `companyPhase`, the horizon) and `test/company-billing.test.ts` (46: standing per row, the notice and its reasons, a lapsed plan beside a later-ended trial, the view, the copy, no "until we restore"); `test/support-grants.test.ts` now 31 and `test/features.test.ts` gains the route. The package: 838 cases in 60 files.
  - apps/api: new `test/company-standing.int.test.ts` (S-1 to S-21), `test/billing.int.test.ts` (20 tests: B-1 to B-4, B-5a to B-5h, B-6 to B-11, and two for B-13), the unit `test/company-standing-guard.test.ts` (7) and the helpers in `test/support/company-facts.ts`; `test/isolation.int.test.ts` gains a comment only. The API unit project: 79 tests in 14 files.
  - apps/web: new unit `tests/unit/company-standing.test.tsx` (41: the watch, the rules and the re-check queue, the screens', banner's and page's markup, the HTTP paths, `canOpenPage` and the menus) and `tests/unit/demo-billing-support.test.ts` (7). The web unit suite: 108 tests in 9 files. New demo `tests/e2e/billing.spec.ts` (3 Flooring tests and 1 `@hr`), /settings/billing in `tests/e2e/screens.ts` for both hosts, new api-mode `tests/e2e-api/company-standing.spec.ts` (2 tests), and `tests/e2e-api/global-setup.ts` clears a stale Summit and the test agent.
  - packages/db: new `test/standing-test-helpers.int.test.ts` (5, the Summit-only refusals among them) for `readStandingFacts`, `restoreStandingFacts`, `setMaintenance`, `setPeriodEnd`, `ensureTestSupportAgent`, `insertSupportGrant`, `removeTestSupportAgent` and `clearTestStanding`.
  - Runs before the docs stage: the demo build with the billing, users, admin, settings, roles, audit, a11y, console and responsive specs (74 passed), and the api-mode company-standing, login, platform-admin, platform-support and users specs (14 passed), then company-standing again on the same builds (2 passed), leaving Summit as it was.
