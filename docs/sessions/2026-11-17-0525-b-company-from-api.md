# Session 2026-11-17 05:25, B (Claude): the shell's person, roles, access, modules and branches come from GET /company (queue item 2, task 1)

Person: B (Claude), on B's Mac. Branch `feat/web-company-from-api`, base `4b78e8b` (the head of B6's branch `fix/sales-quote-resave`, with B6's handoff; draft PR #49). Main is `d0e4e20` (B2 merged in PR #44). This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #49.** B6 (#49) is stacked on B5 (#48), B4 (#47), B1 (#46) and B3 (#45). None can merge yet: GitHub Actions is blocked by a billing problem on the account. The orchestrator cut this branch from B6's final head so that STATUS and BRANCHES stay linear and the shared edits (`api-methods.ts`, `contract.ts`, `store.ts`, `sales.spec.ts`, `packages/shared/src/index.ts`, api-contract.md, ADR 0037) can't conflict later (D19). The PR must merge after #45, #46, #47, #48 and #49; when they merge, the orchestrator merges `origin/main` into this branch.

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 2, task 1: `GET /company` first (roles, modules and permission limits, so buttons match what the API allows). In api mode the shell's person, roles, access, modules and branches come from the API, which closes ADR 0051 R1; demo mode is unchanged apart from the View as gate (D16). Security review required (tenancy, permissions, data scope). Its api-mode coverage: the Sales → Team test comes back (B5's follow-up) and a new `apps/web/tests/e2e-api/company.spec.ts`; the whole demo suite runs at the end, because the provider touches every screen.

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 2 (the company from the verified session), rules 3 and 4 (deny by default, permissions only from packages/shared), JSDoc on exports, no dead code, no duplicated logic.
- If a stop-and-ask item comes up (a core/auth or core/tenancy change, a new dependency, a table change), stop and report it instead of building it.
- ADR numbers: 0058 is reserved by the paused check branch, so this work adds a dated section to ADR 0051, where R1 lives.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`.

### The problem as recorded
- **ADR 0051 R1** ("Who is looking" and part 3's residual risks): in api mode the client's keys and scope come from the shell's DemoStore roles until `GET /company` and the roles move.
- **docs/STATUS.md:** "The api-mode company shell still reads modules and the ceiling from DemoStore until `GET /company` moves"; "Cost displays gated only by the shell's `can()`" (D19 of B1); "R1 symptoms found while fixing B4" (the Users page's Branch column, a new quote's "sold at", `user.id` and `user.defaultLocationId`, `saveQuote`'s `branchId` and `salesRepId`); B5's "The Sales → Team api-mode e2e comes back with `GET /company`"; PR #11's "give the shell the effective permissions from the API"; Q-B4-2 (the invite's branch in api mode).

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff) and the CI budget.
  - `.claude/commands/feature.md`, steps 1 to 9.
  - docs/product-spec/settings-and-permissions.md: "Who uses it", the workflows "Invite a user" and "View as", rules 20 to 24, Entities (Company, Role, User, Access), Edge cases and Real build.
  - docs/api-contract.md: Permissions (`@AnyCompanyMember()` and the `GET /locations` exception), the Settings → Users and roles rows, "Company standing and billing", the ApiClient table (`getCompany`, `setViewer`, `today`, `list`, `whoAmI`).
  - ADR 0051 ("Who is looking", "The company's day", part 3's owner item 3, R1 and R10); ADR 0029 (the session bridge); ADR 0031; ADR 0034 (Settings reads users and roles through its own methods); ADR 0037 (the D19 and Team lines); ADR 0044 ("The web leaves a new contract's branch to the API"); ADR 0052 (the console's ceiling note); ADR 0054 (the standing route, "no billing facts").
- **Where the problem was found:** docs/STATUS.md (above); B4's session log (Q-B4-2), B5's (the Team test left out) and B1's (D19, Team empty in api mode).
- **The code at `4b78e8b`:**
  - **API:** `core/access/access.service.ts` (`resolve`, `RequestAccess`), `permission.guard.ts` (`PERMISSION_REFUSALS`, the disabled and MFA refusals, `@CurrentAccess()`), `permission.decorators.ts` (`@AnyCompanyMember()`); `modules/users/` (`users.controller.ts`, `users.service.ts` `list` and `knownBranch`, `role-records.ts` `loadRoles`, `roleView`, `heldRoles`); `modules/inventory/inventory.controller.ts` (`GET /locations`); `modules/billing/company-standing.controller.ts`; `modules/sales/sales-common.ts` (`companyClock`).
  - **Shared:** `permissions/engine.ts` (`resolveAccess`), `permissions/access-rules.ts` (`SENSITIVE_FIELDS`), `features.ts`, `platform/company-standing.ts`, `index.ts`.
  - **Web:** `components/workspace/workspace-provider.tsx` and `workspace-context.ts`; `lib/access.ts` (`viewerAccess`); `components/shell/view-as.tsx`, `user-menu.tsx`, `profile-dialog.tsx`, `command-palette.tsx`; `lib/api/contract.ts`, `demo/store.ts`, `http/api-methods.ts` (`SERVED_LISTS`, `list`, `get`, `saveQuote`, `contractBody`, `meetingsData`); `lib/session/api-context.ts` and `server.ts` (the bridge, unchanged); `features/standing/company-unavailable.tsx`; `features/settings/users/users-page.tsx` and `invite-dialog.tsx`; `features/settings/locations/locations-page.tsx`; the R1 symptom sites (quote page, transfer and purchase-order dialogs, own-record checks, `list("users")` readers).
  - **Tests:** api `permissions.int`, `isolation.int`, `users.int`, `company-standing.int`, `auth-harness.ts`, `support/platform-admins.ts`; web `api-rereads.test.ts`, `fake-api.ts`, `products-demo-only.test.ts`; e2e-api `sales.spec.ts`, `accounts.ts`, `flows/kit.ts` and `flows/checks.ts`; demo `shell.spec.ts`.
- **Planning:** a first plan, a critic's review (two must-fix items and nine should items, S1 to S9) and a final plan that applies them, written against B5's head `ab9a82f` and re-checked on B6's head here (B6 moved line numbers in `api-methods.ts`, `store.ts`, `sales.spec.ts`, STATUS, ADR 0037 and sales.md; every edit is anchored on text). The plans live in the session scratchpad, not in the repo, so the plan is restated below.

## Plan (short)

### The API: `GET /company`
- **One new company route** in the users module (`company.controller.ts`, `company.service.ts`): SessionGuard, TenantGuard and PermissionGuard as for any company route, `@AnyCompanyMember()` on the handler, `Cache-Control: no-store`, not audited, no module or feature switch (shell core, like the standing route).
- **The answer** (`CompanyAnswer`, a new shared type in `packages/shared/src/platform/company-answer.ts`):
  - `company`: the tenant's id, slug, name, city, state and time zone, the modules, the live branches by name (id, name, city, state), and the ceiling only for holders of a role or user settings key (`seesCeiling`, the keys `GET /roles` takes), else `null`;
  - `me`: the caller's own `User`, exactly as `GET /users` shapes it (a new `UsersService.one`, sharing `list`'s mapping);
  - `roles`: only the roles the caller holds, as `GET /roles` shapes them;
  - `access`: `@CurrentAccess()` of the same request (the guard's own, sorted keys, data scope, owner flag), never a second resolution;
  - `people`: id, name and status (active or disabled) of every live profile with an account, invited people left out (`directoryOf`).
- **Never:** another company's anything, another person's email, title, roles, branch, MFA, sign-in time, employee link or default warehouse, a role the caller doesn't hold, the ceiling without a settings key, billing facts (plan, status, limits), feature switches, or a field named in `SENSITIVE_FIELDS`.

### The web
- **`getWorkspace()`**, a new ApiClient method: `GET /company` in api mode (mapped by a pure `workspaceFromAnswer` that drops unknown keys and modules, failing closed); in the demo, DemoStore answers from exactly what the shell computed before, with the same ceiling rule.
- **The provider** reads `getWorkspace()`, `getCompany()` and `getSettings()`. The company facts (name, city, state, modules, ceiling, branches) lie over `getCompany()`'s plan, status, limits, product and id. The access is the facts' own (in api mode the guard's), unless the demo's View as applies. The rules move into pure modules: `build-workspace.ts`, `open-workspace.ts`, `lib/view-as.ts`.
- **View as** is demo only, and in the demo applies only to an Owner or someone holding `settings.roles.manage`; a stored choice that doesn't apply is cleared, and DemoStore is never left acting as a stored role for anyone else. A View-as access is computed against DemoStore's own company.
- **Your profile** is hidden in api mode (no `PATCH /me` yet).
- **A refused first read** of `GET /company` shows a full page: the company-unavailable panel for a standing refusal, else the API's message, with Try again and Sign out (`workspace-refusal.ts`, `WorkspaceRefused`).
- **In api mode** `list("users")` and `get("users")` give `GET /company`'s people (id, name, status; every other field empty); `whoAmI()` is `GET /auth/context`'s `user.id`; `saveQuote` sends no `salesRepId` or `branchId`.
- **Settings → Users' invite dialog** starts at the inviter's own branch and lists only that branch when the inviter's data scope is narrower than `all` (`inviteBranches`). **Settings → Locations** reads its branch names from `getCompany()`, the same source as its locations.
- **Nothing changes** in `apps/web/src/lib/session/`, core/auth, core/tenancy, packages/providers or packages/db. No table, migration, dependency or switch.

### Tests (red first)
- **Shared:** `seesCeiling` and `directoryOf`.
- **API** (`company.int.test.ts`, supertest against throwaway databases): every default role of each product (C1), branches (C2), people (C3), nothing beyond the caller's own (C4), another company and request-named companies (C5), a module off (C6), a ceiling below the role (C7), refusals (C8), headers and audit (C9), the standing route (C10).
- **Web unit:** the answer's mapping, `list("users")`, `whoAmI` and `saveQuote` (W1 to W6); the View-as rules (V1 to V5); `buildWorkspace` (B1 to B6); DemoStore's `getWorkspace` and `openWorkspace` (D1 to D6); the refusal map (R1 to R4); the invite branches (I1 to I5); two new read cases in `api-rereads.test.ts`.
- **Api-mode e2e:** `company.spec.ts` (E1 buttons follow the API's answer, D19 safe; E2 the Owner's shell; E3 new documents start from the person's showroom and warehouse; E4 a disabled member sees the refusal and signs out) and the Sales → Team tests (T1, T2).
- **Demo e2e:** S1 in `shell.spec.ts` (a stored View as doesn't carry over to someone who may not view as).
- **Mutations** M1 to M18 on the final code.

### Stages
0. This log and the spec (docs only), the draft PR.
1. Red tests, no product code (no commit).
2. The change: 2a shared and API, 2b web, each with its unit and API tests and checks; mutations.
3. Api-mode and demo e2e (green), the e2e tests committed.
4. Docs: ADR 0051's dated section, api-contract.md, the delta row, FEATURES.md notes, closure notes.
5. Full checks, the whole demo and api-mode suites, reviews, handoff.

## Decisions and why
Planned decisions, each the safest option found. D16 to D18 came from the critique of the first plan. Decisions taken while building go under "Decisions taken during the build".

- **D1, a new company route, not `/auth/context`.** `/auth/context` is session-only by design (ADR 0029, ADR 0030): it answers before a company is chosen and never opens a company database. Putting roles, keys and branches there would mean a session-only route that repeats TenantGuard's checks, a core/auth change (ask-before). A company route gets every TenantGuard and PermissionGuard check, in order, and `@CurrentAccess()` is the very access the guards use, so the answer can't drift from what the API allows. docs/api-contract.md already names `GET /company` for the shell's company.
- **D2, View as is not offered in api mode.** The API answers for the signed-in person only, so a viewed role's buttons could offer what the API refuses (a role manager can view as a role holding keys they don't have), and its data would still be the viewer's own. The demo keeps View as; Settings → Security roles' access preview stays the way to see what a role may do. A stored `fp-view-as:<company>` is ignored in api mode. Q1; a delta row.
- **D3, the access is the guard's own, never recomputed on the client.** Recomputing from roles, ceiling and modules would repeat the engine and miss any later guard rule (the disabled rule already differs). Unknown keys and modules are dropped on the web (fail closed).
- **D4, the ceiling goes only to holders of a role or user settings key** (`seesCeiling`: `settings.roles.view`, `settings.roles.manage`, `settings.users.view`, `settings.users.manage`, the keys `GET /roles` takes). Only Settings → Security roles and Users read it. Everyone else gets `null` (`[]` on the web), which no computation of theirs uses, since a View-as access uses DemoStore's own company (D16). The demo applies the same rule. Q3.
- **D5, a people directory to every member: id, name and status, for active and disabled people, never invited ones.** Names beside records and Sales → Team need it, because the API's records carry ids. **What is new, plainly:** every member, whatever their keys or modules, learns the names of colleagues who were disabled, and that they are disabled. The existing name sources give active members only, and only to holders of `meetings.meeting.create` (`GET /meeting-guests`) or `hr.portal.view` (`GET /me/meetings`). Disabled people stay so history keeps its names and Team totals keep a disabled rep's revenue (`teamStats` keeps only users in the list). Names aren't in rule 5's sensitive list, and the demo already shows every member's full record to everyone. Nothing else about anyone is sent. The narrower option is Q2.
- **D6, feature switches don't travel.** They are code in packages/shared, the same build in web and API; the API answers 404 for a switched-off feature and the shell hides it with the same `featureOn`. There is no per-company switch (spec rule 19).
- **D7, Settings → Locations reads its branches from `getCompany()`.** Its locations are DemoStore's in api mode and its saves go there, so its branch names must be DemoStore's too, while the shell's branches are now the API's. When Locations moves (the Settings task), the page reads the API's.
- **D8, Your profile is hidden in api mode.** It reads DemoStore's locations and saves to DemoStore only; the API's default warehouse (`user_profiles.default_location_id`) can't change until a `PATCH /me` exists (Q5). The quote, transfer and purchase-order dialogs now read the API's value.
- **D9, `saveQuote` sends neither `salesRepId` nor `branchId`**, as B4's D1 did for contracts. The server sets both and ignores what is sent; keeping client-chosen values off the wire lets the schema become strict later.
- **D10, `whoAmI()` is `GET /auth/context`'s `user.id` in api mode**, the read `meetingsData` already makes. No `GET /me/id` is built.
- **D11, no limits, plan or status in `GET /company`.** ADR 0054 keeps billing facts, limits included, on the Owner's `GET /billing`. The seat meter keeps `getCompany()`'s number in api mode (pre-existing). Q4.
- **D12, no settings in `GET /company`.** The shell's branding and number format come from `getSettings()`, which the Settings task routes; the shell then follows with no change (rule 1).
- **D13, branches are ordered by name**, so the answer is deterministic. The invite dialog's default is the inviter's own branch (D18), not the first by name.
- **D14, a dated ADR 0051 section closes R1** (no new ADR; 0058 stays reserved). ADR 0051 is where R1 lives, and the B2 change set the precedent of a dated section.
- **D15, the bridge stays.** An account with no fixture twin still can't open the shell in api mode (`toCompanySession`). Removing the bridge needs every DemoStore-backed screen moved.
- **D16, View as applies only when offered and the person may view as** (critique must-fix 1). `viewAsRoleFor` gates it: demo only; the Owner, or a held role listing `settings.roles.manage`; never the owner role. It gates in three places: when the stored choice is read (`openWorkspace`), when the shell is built (`buildWorkspace`), and for the switcher (`useCanViewAs`). A stored id that doesn't apply is cleared. A View-as access is computed against DemoStore's own company, so D4's trimmed ceiling never empties it. This closes the blank app D4 would have caused in the demo (Cole after Dana's View as Sales got no permissions at all) and a pre-existing leak (Cole silently got Sales's buttons, and DemoStore acted as Sales for him). A behaviour change, recorded: in the demo a stored View as no longer survives a sign-in by someone who may not use it; Dana → View as Sales → Cole → Dana starts as herself.
- **D17, a refused first read of `GET /company` shows a full page with Try again and Sign out** (critique must-fix 2). A standing refusal shows the company-unavailable panel for that state; anything else shows the API's own message. Re-reads keep the last data, as today. Without this screen a disabled member (still a member with a live session) or one refused by the MFA backstop would be stuck: no shell means no Sign out, and `/login` sends them back to `/`.
- **D18, the invite dialog defaults to the inviter's own branch, and lists only that branch when the inviter's data scope is narrower than `all`** (critique S2). Without it, the live branches would make STATUS's open hole (a branch-scoped admin inviting into another branch) one click away. Client-side and narrowing only; the server check stays the STATUS item, named in the security focus and Q6.
- **D19, stacked on B6 (#49) (the orchestrator's decision).** The final plan was written against B5's head `ab9a82f` and said the branch is built on B6 once B6 hands off. B6 handed off at `4b78e8b` and holds B5, B4, B1 and B3. The orchestrator cut this branch from B6's final head (`git switch -q --no-track -c feat/web-company-from-api origin/fix/sales-quote-resave`) so STATUS and BRANCHES stay linear and the shared files can't conflict later. Section 0 step 1's checks ran: B6's newest commit is its handoff (`4b78e8b docs: hand off B6 (PR #49), review clean after five rounds, CI still blocked by billing [skip ci]`), it holds B5 (`merge-base --is-ancestor` true), and its one open PR is #49 (draft). The PR body says it is stacked on #49 and must merge after #45 to #49.
- **D20, tests red first, never committed red.** feature.md step 4 hands the API and Playwright tests to the test-writer subagent. This session runs as a subagent without one, so the builder writes them from the final plan's test section, as B1 and B6 did.
- **D21, STATUS and BRANCHES are left to the orchestrator**, which applies "For STATUS" below at handoff.

### Decisions taken during the build
- **B1, the red API run answers 404 for C8's first check too.** The plan expected C8's 401 to pass before the route existed; an unknown route answers 404 before any guard runs, so every C case but C10 (the standing route) was red. Nothing to change.
- **B2, the e2e checks the screen before the answer.** E1 first checked the armed `GET /company` answer, so on the old code it waited 30 s for a read that never comes. It now checks the visible symptom first (no "New quote") and the answer after; T1 checks Priya's Team row before awaiting the reads. Both were re-run red and failed at the symptom.
- **B3, a type stub only for the red build.** `next build` type-checks `tests/**` (apps/web/tsconfig.json), and the two e2e specs import `CompanyAnswer`, which packages/shared didn't have yet. For the red runs only, both specs held a local `type CompanyAnswer` (types are erased, so the runtime is the same); the committed specs import the shared type. The six red unit files and the new `api-rereads` cases were kept aside the same way, then put back; `git status` showed exactly the stage's files afterwards.
- **B4, each e2e case in its own describe with its own `resetAuthAround`.** `personas.open(OWNER_EMAIL, { mfa: true })` enrols an authenticator and needs an account without one, and E1, E2 and E4 each sign Dana in that way. A describe per case resets her (and the case's other people) before and after it.
- **B5, the answer's ceiling is sorted,** like its keys, so the answer is deterministic whatever order the control rows come in.
- **B7, the e2e specs are committed with stage 2, not stage 3.** The plan commits `company.spec.ts`, `sales.spec.ts`, `accounts.ts` and `shell.spec.ts` after their green run in stage 3, which is the next session's. They were red-checked in stage 1 and pass web typecheck and lint, so they are committed after the change (their own commit, after the mutations) rather than left only in this checkout (CLAUDE.md: nothing important only on one laptop). Stage 3 runs them green and commits any fix.
- **B8, the refused-workspace screen shares the blocked screens' panel and frame.** `company-unavailable.tsx` now exports `BlockedPanel` (icon, title, the API's words, Try again and Sign out), `UnavailablePanel` (the same for a standing state, unchanged on screen) and `FullPageCard` (the full-page frame). `WorkspaceRefused` uses them, so there is one copy of the markup (plan 2.3 "reuse, not copy"). Its message case uses the danger tokens and a shield icon (decoration, `aria-hidden`).
- **B9, `openWorkspace` reads the facts once more in the demo only.** With a stored choice in the demo it reads `getWorkspace()` before the provider's own query, to decide whether the choice applies before DemoStore acts on it; a failed read applies nothing. In api mode it never reads them (D6 test).
- **B6, the query count (risk R1, from the code):** `GET /company` makes ten queries of its own on top of the guards': four on the control database (the tenant row, the caller's account, the caller's passkeys, the people's names) and six on the company database (branches, the caller's profile, the caller's held roles, the people's profiles, the roles, the roles' keys).
- **B10, the standing spec waits for the app's reads before it starts maintenance** (`company-standing.spec.ts`, stage 3). The first green run failed one test there, at its maintenance step: the click on "Audit log" was blocked by the "Under maintenance" overlay, which was already up. The trace shows why: after the support-access revoke, the transport's re-read reads `GET /company`, and its new answer gives the shell a new access object, so the attention list (the bell) loads again: `GET /auth/context` (`whoAmI`, now the API's), then its lists. One of those reads, a `GET /payments`, was still open when the test put Summit under maintenance behind the API's back, and its 503 `company_maintenance` raised the overlay before the click. Before this branch the shell's re-read was DemoStore's and the second attention load started at once, so the chain ended sooner; it had passed in every earlier full run. The overlay on any standing refusal is the designed behaviour (ADR 0054), so the product is right and the test's timing assumption was not. Both maintenance steps now wait until the page has had no `/api-proxy/` request open for 300 ms (`apiReads(page).settled()`); three runs in a row pass. The attention list loading twice after each write is as before this branch; a stable access identity in the provider would halve it (a follow-up in "For STATUS", not built here: it is outside the plan and changes every screen's timing).
- **B11, stage 3's commit holds only that spec fix.** The four e2e files the plan commits in stage 3 were committed in stage 2 (B7); they passed unchanged.
- **B12, the trace of the failed run stays in the scratchpad.** It holds a throwaway local session cookie, so nothing from it is quoted here or in the PR beyond the request list.

## Tests that pin it

| Path | Pinned by |
| --- | --- |
| The answer is the guard's own access, every role | C1; M5 |
| `me` is exactly GET /users' entry (the lighter `one`) | C1 |
| Ceiling only for the settings keys | C1, C7, shared `seesCeiling`; M1 |
| Held roles only | C1; M4 |
| People: id, name, status; no invited or deleted; nothing else about anyone | C3, C4, shared `directoryOf`; M2, M3 |
| Own company only, whatever the request names | C5 |
| A module off and a ceiling below the role agree with the guarded routes | C6, C7; M5, M6 |
| Disabled, MFA, no company, wrong product, no session | C8 |
| The web uses the server's access, never recomputed; unknown keys dropped | B1, W2; M7, M8 |
| View as off in api mode | V1, V5, B2, E2 (screen); M9 |
| View as only for someone who may use it; a stored one cleared; DemoStore not left as the stored role | V2 to V4, B5, D5, D6, demo S1; M14, M15 |
| A View-as access never meets a trimmed ceiling | B6; M18 |
| A refused first read: standing panel or message, with Sign out | R1 to R4, E4; M16 |
| Buttons follow the API, not DemoStore; the API refuses what's hidden and allows what's offered | E1 steps 1 and 2 |
| D19 safe: no cost column and no crash when the API withholds cost | E1 step 3 |
| Branches: Users column, invite default and body, Locations page | E2 |
| Invite branches narrowed for a scope below `all` | I1 to I5; M17 |
| Sold at, Fulfilled from, transfer From | E3 |
| Names and Team from the API | W4, T1, T2; M10 |
| `whoAmI`, `saveQuote` bodies | W5, W6; M11, M13 |
| Demo parity and demo behaviour unchanged | D1 to D4, B3, B4, the demo subset and the whole demo suite; M12 |

The e2e side is pinned by the red runs on B6's code (stage 1): E1 failed at "New quote", E2 at the "Viewing as" banner, E3 at "Sold at", E4 at the refusal heading, T1 and T2 at Priya's Team row, and demo S1 at the banner shown for Cole.

## Owner questions
None blocks the build; each has its safest default taken.

- **Q1, View as in the real product.** Taken: not offered in api mode; Settings → Security roles' access preview shows what a role may do. In the demo, only for an Owner or someone who manages roles, and a stale choice is cleared. Build a server-side "see as a role" later, or keep it demo only?
- **Q2, the people directory.** Taken: every member sees colleagues' names and whether they are active or disabled (invited people left out), for names beside records, Team and the split picker. This is new: until now only active names reached meetings and portal key holders. Narrower options: (a) disabled people only for `settings.users.view` or `sales.commission.view` holders, so other roles see "Unknown" beside a disabled colleague's history; (b) only the people in the viewer's data scope. Team totals for Accountant and Manager need disabled reps either way.
- **Q3, the ceiling.** Taken: only holders of a role or user settings key receive it. Confirm.
- **Q4, the seat limit.** Taken: `GET /company` carries no limits, since ADR 0054 keeps them on the Owner's Billing page; the Users page's seat meter keeps DemoStore's number in api mode. Give Users viewers (Owner, Manager, HR) the user limit in `GET /company`, or show the meter to the Owner only, from `GET /billing`?
- **Q5, Your profile.** Taken: hidden in api mode. Build `PATCH /me` (the person's own default warehouse, audited) with the Settings task?
- **Q6, invite branches (Q-B4-2, narrowed, and STATUS's branch-scoped admin item).** The invite dialog now sends the API's branches, defaults to the inviter's own branch, and lists only that branch below scope `all`. Should the API refuse an unknown branch with 400 and record the stored branch in the invite's audit row? Should the API keep a branch-scoped admin's invitations and branch changes to their own branch (the server half of D18)? Recommended next, since the screen now shows real branch ids.
- **Q7, CI time.** `company.spec.ts` adds about 11 s to `e2e` (E1 4.3 s, E2 2.3 s, E3 2.2 s, E4 1.9 s on the first green run; 12 s on the second), and the Team tests about 3 s (T1 1.9 s, T2 1.3 s). This joins PR #42's CI question.

## For STATUS
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Re-read STATUS first; anchor on the quoted text. This branch's draft PR is #50.

- **"In progress" and "Next three tasks" item 2:** "`GET /company` first …" gains "(draft PR #50, `feat/web-company-from-api`, stacked on #49)"; Settings is next.
- **"Tests" or the e2e notes, if STATUS lists changed specs:** `company-standing.spec.ts` now waits for the app's reads before it puts Summit under maintenance (B10).
- **"Done": a GET /company entry,** next to B6's: "GET /company (queue item 2, task 1), PR #50 (ADR 0051 'GET /company'): in api mode the shell's person, roles, effective access (the guard's own), modules, ceiling (role and user settings keys only) and branches come from `GET /company`; View as and Your profile are demo only, and in the demo View as applies only to someone who may use it; a refused first read shows a full page with Sign out; names beside records and Sales → Team come from its people (id, name, active or disabled); `whoAmI` is the API's id; `saveQuote` sends no rep or branch; the invite dialog defaults to the inviter's own branch and lists only it below scope `all`. No schema change, migration or dependency; nothing in core/auth, core/tenancy, providers or the web's session. Checks: lint, typecheck, unit (shared 1,125, web 346, api 124, db 18, providers 11), `test:api` (api 654 in 36 files, db 59, providers 2) and `test:hooks` (15) pass; the whole api-mode suite 46 passed in 2.8 min; the whole demo suite (flooring 444 passed and 7 skipped, hr 67 passed); 18 mutations caught. CI could not run (Actions blocked by billing)."
- **Remove or close:**
  - "The api-mode company shell still reads modules and the ceiling from DemoStore until `GET /company` moves …";
  - "**Cost displays gated only by the shell's `can()`** …" (safe once `can()` is the API's; the stale-window hardening moves to the follow-up below);
  - "**R1 symptoms found while fixing B4** …" (all four bullets: Branch column, sold at, `user.id` and `defaultLocationId`, `saveQuote`);
  - B5's "The Sales → Team api-mode e2e comes back with `GET /company` …";
  - meetings' "R1: in api mode the client's keys and scope still come from the shell's DemoStore roles …";
  - PR #11's "In api mode the app shell's on-screen permissions still come from the demo's roles …";
  - the dialog half of "In api mode the Users screen's branch picker still lists the demo's branches …" (it lists the API's branches; the server's unknown-branch rule and the audit row stay with Q-B4-2).
- **PR #11's "First: keep a branch-scoped admin's branch changes and invitations to their own branch …":** add "the invite dialog now lists only the inviter's branch below scope `all` (client-side, D18); the server check is still open and is now the only thing between a crafted request and another branch."
- **Q-B4-2:** "the dialog now sends the API's live branches (`GET /company`); the open part is whether the API should refuse an unknown branch (400) and record the stored branch in the audit row."
- **New follow-ups:**
  - **Warehouse today** (`warehouse-today.tsx`) compares the API person's warehouse with DemoStore's orders and transfers, so those counts read 0 for someone with a default warehouse (Cole, Renata) until those lists are served from the API.
  - **Stock adjustments** (`adjustments-panel.tsx`): the own-request check compares `user.id` with DemoStore rows; it comes right when adjustments move (next tasks in item 2).
  - **Still DemoStore's in the api-mode shell:** plan, status and the seat meter's limit (`getCompany()`; Q4); branding and number format (`getSettings()`, the Settings task); and every DemoStore-backed screen's own permission check (its demo roles; it can only refuse more).
  - **The company's zone has two copies** (`tenants.time_zone`, the company settings' `localization.region.timeZone`). The Settings task must write both on a Localization change; the `today()` task reads `GET /company`'s `company.timeZone`.
  - **Your profile** waits for `PATCH /me` (Q5).
  - **The company switcher** in api mode still lists DemoStore's companies and signs in through `/api/demo/login`, which doesn't exist there (pre-existing).
  - **An account with no fixture twin** still can't open the shell in api mode (`toCompanySession`). This goes when the last DemoStore-backed screen moves.
  - **D19 hardening:** the five cost displays meet `formatNumber(undefined)` if a role changes between the shell's read and the page's (a crash, nothing shown). Apply the unknown-cost rule with B1 Q4's typed records.
  - **`list("roles")`** is read and unused on Sales and the dashboard (`sales-page.tsx`, `use-dashboard-data.ts`); drop the reads.
  - **A person disabled mid-session** keeps the last shell data (re-reads keep data on error) until a reload, when the refusal screen shows; every API call is refused meanwhile.
  - **The attention list loads twice after each write** in api mode: once in the transport's re-read, and again when the shell's re-read of `GET /company` lands with a new access object (B10). It did so before this change too; keeping the access object when its keys, scope and owner flag are unchanged would halve the reads.
- **Owner questions:** a new block, "Owner questions (PR #50, GET /company; none blocks)", with Q1 to Q7 above.
- **BRANCHES:** a `feat/web-company-from-api` row: "B (Claude)", "Queue item 2, task 1: the shell's person, roles, access, modules and branches come from GET /company (closes ADR 0051 R1) (main checkout; stacked on #49)", "Draft" then the state at handoff, the PR, "see the branch".

## Outcome

Stages 0 to 4 and stage 5's checks and suites are done; the reviews and the handoff (stage 5 steps 5 to 8) are the orchestrator's next steps. In api mode the shell's person, roles, access, modules, ceiling and branches come from `GET /company`, which closes ADR 0051 R1. Every check and both whole e2e suites pass on the final code. No stop-and-ask item came up.

### Commits

| Commit | Subject |
| --- | --- |
| `b0a5b70` | docs(settings): plan for GET /company, the shell's access from the API |
| `112876c` | feat(api): GET /company answers the person's company, roles, access, branches and people |
| `23637f2` | feat(web): the shell's person, roles, access, modules and branches come from GET /company |
| `4a0beec` | test(e2e): GET /company specs, red on B6's head; the green run is stage 3 |
| `bb2ed76` | test(e2e): the standing spec waits for the app's reads before maintenance |
| `8ac1c89` | docs: GET /company closes R1 (ADR 0051, api-contract, spec, delta) |
| this commit | docs(sessions): GET /company outcome, full checks and both suites |

Every commit carries `[skip ci]`; the handoff commit is the first without it.

### Checks on the final code

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | pass (shared, api and web ran fresh; db, providers and ui were Turbo cache hits, unchanged) |
| `pnpm test` | shared 1,125 (74 files), web 346 (44), api 124 (17), db 18, providers 11 |
| `pnpm test:api` (PostgreSQL on 5432, throwaway databases) | api 654 (36 files), db 59, providers 2; nothing cached |
| `pnpm test:hooks` | 15 |
| Whole api-mode suite (`company-all-final`, fresh build) | 46 passed in 2.8 min: B6's 40 plus E1 to E4, T1 and T2. E1 4.6 s, E2 2.1 s, E3 2.0 s, E4 2.1 s, T1 1.7 s, T2 1.4 s; the standing spec's Owner test 8.2 s |
| Whole demo suite (`e2e-demo.sh all`, one worker) | flooring 444 passed and 7 skipped in 504 s; hr 67 passed in 67 s |
| Mutations M1 to M18 | each caught (stage 2) |

**The demo's seven skips** are the tests' own: six `skipIfFeatureOff` for switches that are `removed` (`installation.calendar` three times, `inventory.adjustments` twice, `reports.tax-jurisdiction` once), and `notifications.spec.ts` "marking an invoice sent …", which skips itself when the first open invoice is already sent ("This invoice was already sent"). The branch changes no invoice or notification code; that skip was not re-run on B6's head.

### Left for the next steps
- Done at handoff: the review (round 1, clean; its summary posted on PR #50) and STATUS and BRANCHES from "For STATUS" below.
- Ready and merge after #45 to #49 merge and `origin/main` is merged in, with `verify` and `e2e` green.

## Review round 1 (final, clean)
The orchestrator ran it on this branch's own commits (`4b78e8b..90734da`): a fresh, read-only security-reviewer with the plan's section 10, and a correctness reviewer. Both passed. No schema review: no schema or migration change.
- **The one should-fix, raised by both:** a stored View as choice is kept per company (`fp-view-as:<companyId>`), not per person, so another person who may view as and signs in on the same tab inherits it. Two skeptics judged it a note: the key predates this branch, D16 scoped the gate to "someone who may view as", it is demo only, and nobody gains anything (the banner shows and "Stop viewing as" is one click). Both found one real point: the spec sentence this branch added overstated the rule. **Fixed at handoff:** settings-and-permissions.md now says the choice is cleared when someone who may not view as signs in, and that it is kept per company.
- **Notes kept for later (STATUS, "GET /company follow-ups", review notes):** D5's new information (who is disabled; Q2); raw keys on held roles show part of what the ceiling blocks; the invite's server-side branch check (pre-existing; Q6); an invited-but-not-accepted person with an existing account passes `GET /company` (pre-existing); load (a full `GET /company` per `list("users")` reader, a quadratic name join); `CEILING_VIEW_KEYS` repeating `GET /roles`' list; the demo's `getWorkspace` giving every role; two out-of-date ApiClient JSDoc comments; two places still comparing the API person with DemoStore lists (already follow-ups).

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `company/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git fetch origin`; `git log -6 origin/fix/sales-quote-resave`; `merge-base --is-ancestor origin/fix/sales-dashboard-without-cost origin/fix/sales-quote-resave`; `gh pr list --head fix/sales-quote-resave` | B6's newest commit is its handoff (`4b78e8b`); it holds B5; one PR, #49 (draft); the tree was clean |
| 0 | `git switch -q --no-track -c feat/web-company-from-api origin/fix/sales-quote-resave` | branch made at `4b78e8b` |
| 0 | `docker ps`; ports 3000 and 4000 | the compose PostgreSQL on 5432 and the api e2e one on 5433 up; both ports free |
| 0 | `pnpm exec prettier --check` on this log and the settings spec | clean |
| 0 | commit 0 (`b0a5b70`), pushed with `-u` by naming the branch; `rev-parse --abbrev-ref feat/web-company-from-api@{upstream}` | pushed; `origin/feat/web-company-from-api` |
| 0 | `gh pr create --draft --base main --head feat/web-company-from-api … --body-file company/pr-body.md` | draft PR #50 |
| 1 | `heavy.sh pnpm --filter @workspace/shared exec vitest run test/company-answer.test.ts`, before the fix | red as expected: "Cannot find module '../src/platform/company-answer'" |
| 1 | `heavy.sh pnpm --filter api exec vitest run --project integration test/company.int.test.ts` (PostgreSQL on 5432), before the fix | red as expected: 20 failed, 1 passed (C10, the standing route). Every C1 to C7 case `{"code":"not_found","message":"Cannot GET /company"}: expected 404 to be 200`; C8 `expected 404 to be 401` (B1); C9 `expected 200 "OK", got 404` |
| 1 | `heavy.sh pnpm --filter web exec vitest run` on the six new unit files and `api-rereads.test.ts`, before the fix | red as expected: the five new modules not found (`build-workspace`, `open-workspace`, `view-as`, `workspace-refusal`, `invite-branches`); W1 to W5 "getWorkspace is not a function", "demo.list is not a function" (W4, the users list fell through to the demo stub), "whoAmI is not a function"; W6 sent `salesRepId` and `branchId`; `api-rereads` 4 failed (149 cases against 147 methods, "c.getWorkspace is not a function") |
| 1 | `npx tsc --noEmit -p tsconfig.json` in apps/web, with the red unit files kept aside and the e2e type stub (B3) | clean. This one ran outside the lock by mistake; every other heavy command went through it |
| 1 | `heavy.sh flows/api-e2e.sh company-red --build -- tests/e2e-api/company.spec.ts tests/e2e-api/sales.spec.ts` | builds 5 s; exit 1 after 136 s: 6 failed, 6 passed (every earlier sales test). E1 at the armed `GET /api-proxy/company` wait (no answer within 30 s; reordered, B2); E2 at the "Viewing as" banner (Dana's stored Sales choice applied, expected 0, received 1); E3 at "Sold at" (expected "Summit Design Studio", received "Denver Central"); E4 at the refusal heading (Victor saw the DemoStore shell); T1 and T2 at Priya's Team row (not found). No clean-up failed. Ports free after |
| 1 | `heavy.sh flows/api-e2e.sh company-red-e1 -- tests/e2e-api/company.spec.ts -g "E1 "`, after B2 | exit 1 after 23 s: E1 at "New quote" (expected 0, received 1: DemoStore's Sales role offers it). Ports free after |
| 1 | `heavy.sh bash company/e2e-demo.sh red` (demo build, then S1, one worker) | build 11 s; exit 1: S1 at the banner for Cole (expected 0 "Viewing as", received 1). Ports free after |
| 2a | the targeted shared and API tests after the change | `company-answer.test.ts` 2 passed; `company.int.test.ts` 21 passed |
| 2a | `heavy.sh company/checks.sh s2`: shared `test`, `typecheck`, `lint`; api `typecheck`, `lint`, `test` | all exit 0: shared 74 files and 1,125 tests (B6's 1,123 plus 2); api unit 17 files and 124. No ESLint warnings (only Node's `url.parse()` deprecation notice) |
| 2a | `heavy.sh pnpm --filter api exec vitest run --project integration` on `company`, `permissions`, `isolation`, `users`, `company-standing` and `billing` | 6 files, 119 passed. The permission and isolation route inventories pick `GET /company` up with no edit |
| 2b | the targeted web unit tests after the change (the six new files, `api-rereads`, `view-as-banner`, `company-standing`) | 9 files, 85 passed |
| 2b | `heavy.sh company/checks.sh s2b`: web `test`, `typecheck`, `lint` | all exit 0: web 44 files and 346 tests (B6's 314 plus 32). No ESLint warnings |
| 2b | `pnpm exec prettier --write`, then `--check`, on the stage's files | clean |
| 2b | commit 2b (`23637f2`) | the web change with its unit tests |
| 2b | `heavy.sh python3 company/mutate.py M1` … `M18`, one at a time, on the committed change | every mutation caught: its tests exited 1 with `expected=True`, and `restored=True`. M1 (ceiling always sent) C1 flooring sales `expected [ 'contracts.billing.create', …(138) ] to be null` (and 7 more C1 roles, C7); M2 (deleted profiles kept) C3 `expected true to be false`; M3 (invited kept) shared "2 directoryOf" and C3; M4 (every role) C1 flooring sales `expected [ { …(9) } … ] to deeply equal [ { …(9) } ]` (12 C1 cases); M5 (raw role keys) C7 `expected [ … ] to not include 'sales.quote.view'` and C6; M6 (every product module) C6 `expected [ 'platform', 'core', 'retail', …(5) ] to not include 'contracts'` and the three hr C1 cases; M7 W2 `to not include 'made.up.key'`; M8 B1 (access worked out again); M9 V1 `expected true to be false` and B2; M10 W4 `demo.list is not a function`; M11 W6 (rep and branch sent); M12 D1 (ceiling given to Priya); M13 W5 `whoAmI is not a function`; M14 V3, B5 and D5 (`expected 'sm-role-sales' to be null`); M15 D5; M16 R1 (and R4); M17 I2 (and I3, I4); M18 B6 (`permissions: Set{}`). `git status` afterwards lists only the four e2e test files |
| 3 | `heavy.sh flows/api-e2e.sh company-green --build -- company.spec.ts sales.spec.ts users.spec.ts login.spec.ts company-standing.spec.ts platform-admin.spec.ts` | builds 14 s; run 108 s: 24 passed, 1 failed. E1 4.3 s, E2 2.3 s, E3 2.2 s, E4 1.9 s, T1 1.9 s, T2 1.3 s; every users, login, platform-admin and earlier sales test passed. E1's clean-ups ran with 2xx (a failed one fails the test), so Sales and Manager are back as they were. The failure: `company-standing.spec.ts` "the Owner reads Billing …", at its maintenance step, "locator.click: Test timeout of 60000ms exceeded", the "Under maintenance" overlay intercepting the click on Audit log (B10). Ports free after |
| 3 | `heavy.sh flows/api-e2e.sh company-standing-fix -- company-standing.spec.ts --repeat-each 3`, after B10, no rebuild (no product change) | 6 passed in 39 s (the Owner's test 8.3 s, 7.8 s, 7.8 s). Ports free after |
| 3 | `heavy.sh flows/api-e2e.sh company-again -- company.spec.ts` (the dirty database, no rebuild) | 4 passed in 17 s (E1 5.7 s, E2 2.2 s, E3 2.2 s, E4 2.0 s) |
| 3 | `heavy.sh flows/api-e2e.sh company-neighbours -- meetings.spec.ts portal.spec.ts flows` | 11 passed in 85 s: F1 to F7 (both F3 tests), meetings (2) and portal (1) |
| 3 | `heavy.sh bash company/e2e-demo.sh subset` (demo build, one worker) | build 12 s; flooring 77 passed and 3 skipped in 75 s (S1 1.4 s; the skips are `skipIfFeatureOff` for `inventory.adjustments` twice and `reports.tax-jurisdiction`, as on B6's head); hr 7 passed in 5 s. Ports free after |
| 3 | `pnpm exec prettier --check` and `heavy.sh pnpm --filter web exec eslint` on `company.spec.ts`, `sales.spec.ts`, `accounts.ts`, `company-standing.spec.ts` and `shell.spec.ts` | clean |
| 3 | commit 3 (`bb2ed76`) | the standing spec's wait (B10) |
| 4 | `heavy.sh pnpm --filter @workspace/shared exec vitest run test/features.test.ts`, after the FEATURES.md notes | 7 passed |
| 4 | `pnpm exec prettier --check` on every doc touched | clean |
| 5 | `heavy.sh bash company/full.sh` (lint, typecheck, test, test:api, test:hooks) | exit 0 in 3 min 32 s: lint 16 s, typecheck 7 s, test 15 s, `test:api` 2 min 53 s, `test:hooks` 1 s. Counts in "Checks on the final code" |
| 5 | `heavy.sh bash company/e2e-demo.sh all` | build 6 s; flooring 444 passed, 7 skipped, 504 s; hr 67 passed, 67 s; status 0. Ports free after |
| 5 | `heavy.sh flows/api-e2e.sh company-all-final --build` | builds 13 s; 46 passed in 167 s (2.8 min). Ports free after |

## Handoff (2026-11-17 06:55)
- Review round 1 was clean. STATUS and BRANCHES applied from "For STATUS" by the orchestrator, with the review notes as "GET /company follow-ups", and the spec sentence on View as corrected. The handoff commit carries `[skip ci]` while GitHub Actions is blocked by billing. PR #50 stays a draft until #45 to #49 merge and origin/main is merged in.
- **Next prompt:** "Queue item 2, task 2 of the owner's queue of 2026-11-16: Settings, part 1 of 6 (Company profile, Number format, Payments and Expense approval on the API: `GET /settings` and `PUT /settings/<section>`, a step-up for Payments, company-wide scope). On a branch stacked on #50 while CI is blocked by billing, build the final plan, with a security review."
