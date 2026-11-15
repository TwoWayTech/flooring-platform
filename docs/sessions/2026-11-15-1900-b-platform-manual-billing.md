# Session 2026-11-15 19:00, B (Claude): platform admin part 2, plans and company status

Person: B (Claude), on B's Mac. Branch `feat/platform-manual-billing`, from main at `86c1689` (platform admin part 4, PR #38, squash-merged; main also holds parts 1 and 3, PRs #34 and #36, and meetings parts 1 to 3, PRs #33, #35 and #37). This is the main checkout, not a worktree. This is an unattended overnight run: the owner is asleep, so open points take the safest option and are recorded in docs/blueprint-delta.md and ADR 0056. The reports build (`feat/reports-api`) runs at the same time in its own worktree (`/Users/sarah/dev/flooring-platform-reports`) and shares the local PostgreSQL on 5432. This branch never touches that worktree, never stops Postgres, never drops a shared database, and never touches the `fp-e2e-worktree` container on 5433.

## Prompt (owner's queue order and decision rule)
- **Queue (owner, 2026-11-15, recorded in STATUS):** "Then the queue restarts in this order: meetings; platform admin and manual billing; reports; import; cross-module api-mode e2e flows; the whole-product check."
- **STATUS, "Next three tasks" 2:** parts 1, 3 and 4 are merged (PRs #34, #36 and #38). "Part 2, reduced (`feat/platform-manual-billing`): plans as data and suspend, reinstate and cancel. Creating or changing a subscription, recording a payment and correcting a period wait for the owner's billing answers (ADR 0052, 'Later parts' and 'For the owner' 7)."
- **Overnight rule:** the owner is asleep. Pick the safest option and record it in docs/blueprint-delta.md.
- **How the orchestrating session applies the rule to this part:**
  - **Follow the spec.** docs/specs/platform-admin.md (the part 2 outline) and ADR 0052 "Later parts" are the approved behaviour. Deviate only in the safer direction: less exposure, deny by default, refuse what can't be done correctly, reversible over irreversible. Record each deviation in docs/blueprint-delta.md and ADR 0056.
  - **No schema, dependency or core change:** no new or altered table, no migration, no new dependency, no `package.json` or lockfile change, and no change in `apps/api/src/core` (auth, tenancy, access). The only change near the life-cycle rule is an export in packages/shared (`companyEverPaid`), with no behaviour change. `git diff --stat origin/main -- apps/api/src/core packages/db/src/control packages/db/migrations` must stay empty. If the plan can't be built without such a change, the build stops and reports it as an owner decision.
  - **Out of scope:** subscriptions, payments, invoices, period corrections, and using a support grant.
  - **The new switch `admin.billing`** follows `.claude/commands/feature-change.md`: features.ts and docs/FEATURES.md kept in sync, hidden everywhere when off, the API included. Its step 2 asks the owner to confirm, which can't happen overnight, so the step-2 impact summary goes in the PR body and ADR 0056, and the key is owner question 43.
  - **Process:** heavy commands (integration tests, the full typecheck, lint and test, builds, Playwright, dev servers) run through the scratchpad lock, one at a time across both builds. Ports 3000 and 4000 must be free before and after any Playwright run or dev server, and only this checkout's own server is ever stopped. The owner's local env file is never opened, printed or edited. The orchestrating session updates docs/STATUS.md and docs/BRANCHES.md; this branch does not.

## Inputs
- **Behaviour sources:**
  - docs/specs/platform-admin.md: parts 1, 3 and 4 as built, and the part 2 outline under "Parts 2 to 4";
  - ADR 0052 ("Later parts", part 2; "For the owner" 2, 4, 7 and 11), ADR 0053 (the audit viewer, the lock on the admin's row) and ADR 0054 (standing, the Owner's notice, `phaseDates`);
  - ADR 0033 (the company life cycle);
  - docs/api-contract.md ("Platform admin (real build, ADR 0052 and ADR 0053)", Tenancy);
  - docs/FEATURES.md (`admin.access`, `settings.billing`);
  - docs/STATUS.md: the platform residual risks and follow-ups, among them "Trial with no subscription stays `full`" and the PR #34 final review notes on plan limits.
- **The code at `86c1689`:** the control tables (`plans`, `plan_modules`, `plan_limits`, `tenant_subscriptions`, `tenants` and its `tenants_status_changed` trigger, `platform_audit_log`), the seed, the shared life-cycle rule (`company-lifecycle.ts`, `lifecycle-dates.ts`), the access rule (`access-rules.ts`, `access.service.ts`, read and not changed), TenantDirectory (read, not changed), the platform guard, the part 1 and part 3 services, the audit allow-list, part 4's standing and billing readers, the web console and DemoStore.
- **Planning:** a part 2 plan, a critic's review of it (five must-fix items M1 to M5 and thirteen should items), and a final plan that applies every must-fix and every should item (two in another form), each re-checked against the code. Those files are in a temporary scratchpad, so the plan and its decisions are written out below.

## Plan (part 2, short)

### Stages (one commit each, pushed; every commit keeps lint and typecheck green)
0. **Plan:** this log; the "Part 2: plans and company status" section of docs/specs/platform-admin.md, with the endpoints, fields, refusals and messages, screens, edge cases and acceptance criteria 64 to 91; owner questions 34 to 47 in that spec's "Waiting for the owner"; and the draft PR.
1. **Shared** (`packages/shared`):
   - `platform/admin-reason.ts`: one reason rule (10 to 500 characters, trimmed) and its message, which the support request's names now alias;
   - `platform/company-status.ts`: `statusAfter`, `staleStatusRefusal`, `companyStatusView`, the input checks and the dialog copy;
   - `platform/plans.ts`: the plan field rules, the in-use rule, `planChanges`, `planModulesAfter` and the audit bodies;
   - `platform/admin-roles.ts`: `mayManageBilling` and `seesAdminReason` (`seesSupportReason` delegates to it);
   - `permissions/company-lifecycle.ts`: export `companyEverPaid`, with no behaviour change;
   - `platform/audit-details.ts`: seven new actions, `BILLING_AUDIT_ACTIONS` and `platformAuditActionOn`;
   - the types, the index, the `admin.billing` key with its docs/FEATURES.md row, the `admin.access` retitle, the audit labels on the web, and unit tests (CS-0 to CS-12, PL-1 to PL-9, AU-1 to AU-5).
2. **Plans on the API:** the guard's route-level switch `@PlatformFeature`, `lockActingAdmin` (part 3's private lock, moved), the plans controller and service, the moved test helpers, tests G-7 to G-9 and P-1 to P-13, the isolation map, and `platform.int.test.ts` at 13 routes and 5 controllers.
3. **Company status on the API:** the status controller and service, the audit reason narrowing and the filter while the switch is off, tests C-1 to C-18 and A-9, the isolation map, and `platform.int.test.ts` at 17 routes and 6 controllers.
4. **Web:** the ApiClient methods, `apiErrorCode`, `DemoRefusal`, the demo plans and status modules, DemoStore, the Plans nav item and the Status tab, /admin/plans with its dialogs, the company status page with its dialog, the shared `ReasonField`, the audit filter; web unit tests W-1 to W-8.
5. **Browser tests:** test-only helpers in `packages/db/src/testing.ts` (Summit only, `e2e-` plans only) with H-1 to H-4; the demo `admin-billing.spec.ts` (D-1, D-2) and both pages in `screens.ts`; the api-mode `platform-billing.spec.ts` and global setup.
6. **Docs:** ADR 0056, notes in ADRs 0052 and 0033, api-contract, the spec as built, docs/FEATURES.md, the delta row, the product spec and the data model.

After stage 6: the full local run, `/review`, then a fresh security-reviewer (permissions, a change in the platform guard, prices) and a fresh schema-reviewer (the test helpers in packages/db, and the bounds), with both summaries posted on the PR. Then the PR is marked ready, `verify` and `e2e` must be green, the PR self-merges under the CLAUDE.md rule, and `/handoff` runs.

### Key decisions (the full list is in "Decisions and why")
- **Nine new /platform routes** on two new controllers in the existing platform module: five for plans, four for a company's status. Every one is session-only, behind `PlatformAdminGuard`, and behind the new switch `admin.billing` at class level. While the switch is off they answer 404 before the admin row is read.
- **Every write is the owner role's,** with a step-up, a reason of 10 to 500 characters, a re-check of the admin's own row under a lock, and one `platform_audit_log` row in the same control transaction.
- **Plans are data.** A plan in use (named by any subscription row, a deleted one included) keeps its modules and limits; its name and prices may change. No plan is ever deleted, and a key is never reused.
- **Suspend, reinstate and cancel change only `tenants.status`** (with the trigger's stamp and `updated_at`) through one shared rule, `statusAfter`. Subscription rows are never touched. Cancel deletes nothing and is undone by reinstate. A status action carries the status the admin saw, so a stale one answers 409.
- **The company database is never opened,** and the company's own `audit_log` isn't written (CLAUDE.md rule 2). The Owner learns of a suspension or cancellation from part 4's standing and notice.

## Decisions and why
**Safe options.** Each one is recorded in docs/blueprint-delta.md, ADR 0056 and the spec's "Safer than the outline (part 2)" (the delta and the ADR in stage 6).

1. **A fresh trial can't be suspended or cancelled, and a company that never had a plan can't be reinstated, from the console (422).** The access rule gives a company with no subscription row every module only while its status is `trial`; for any other status it gives Platform only. So a suspended or cancelled fresh trial would lose every module, and its people couldn't read or export during the read-only days the owner promised (ADR 0033). Fixing that is a core/access change that widens access, which the overnight rule doesn't allow (owner question 34). The refusal and the page name the stop-gap: switch its modules off on its Access page (reversible and audited).
2. **Suspend and cancel never widen.** A shared check refuses any action that would make the company read only or locked later than it already would be, worked out from `companyPhase` itself, with no second copy of the ladder. In practice it fires only for cancelling a never-paid suspension when the status's ladder binds. Suspending a cancelled company is refused outright (it would widen).
3. **Reinstate restores what the rows say:** `active` if the company ever paid, else `trial`. `past_due` is never written, so a company suspended from `past_due` loses its overdue notice when its rows are current; its access doesn't change (owner question 35). Reinstating after a cancel is allowed, because cancel deletes nothing and touches no subscription row (owner question 36).
4. **Cancel changes only `tenants.status`, its stamp and `updated_at`,** plus one audit row. It needs the company's name typed exactly. Nothing is deleted, revoked or detached.
5. **A plan in use keeps its modules and limits.** In use means any subscription row, a deleted one included, names it. Its name and prices may change: a rename shows on every such company's billing page, and a price change changes nothing any company pays, because each company's price is kept on its own subscription row. Per-company changes stay on the Access page (owner question 38).
6. **No plan is ever deleted.** Retire and restore only, both reversible, neither changes a company. A key is never reused (owner questions 44 and 45).
7. **Every new plan names every field:** both prices typed by the admin (0.00 only as typed, no default, no "yearly is ten months" rule), at least one module, and both limits from 1 to 100,000. "No price" would need nullable price columns (a migration) and "unlimited" an owner decision (owner questions 39 and 40).
8. **`admin.billing` hides everything when off.** A route-level switch in the platform guard answers 404 before the admin row is read, so neither the role check nor the step-up reveals the routes.
9. **Every write: the owner role, a step-up, a reason and one audit row in the same control transaction,** under row locks (the admin's own row, then the company or the plan). State checks run under the lock, so two admins can't both apply the same action.
10. **Reasons are seen by the owner role and their author only,** narrowed in SQL first and by the shared view again (owner question 41).
11. **No company database is opened** and the company's own `audit_log` isn't written (CLAUDE.md rule 2; owner question 42).
12. **The console shows the consequences before the step-up.** The server computes the status preview from every subscription row, deleted ones included, at the database's time. A refused action is disabled with its reason, and the shared input checks run before any code is asked for.
13. **Both new GETs send `Cache-Control: no-store`.**
14. **The api-mode e2e touches only Summit's status and its own `e2e-` plans.** It never switches the status trigger off on the shared database, moves Summit back to `active` only, and hard-deletes only `e2e-` plans that no subscription row names.
15. **A status action carries the status the admin saw** (`expectedStatus`). If another admin changed it meanwhile, or a later change won the race, it answers 409 and writes nothing. This is safer than the access PATCH's "last save wins".
16. **The acting admin is re-checked under a lock on their own row** in every plan and status write. An admin deactivated, deleted or moved to the support role meanwhile gets 403.
17. **While `admin.billing` is off, the audit log doesn't offer the seven new actions as a filter** (web, demo and API). Their rows stay listed as history (owner question 47).

**Smaller choices:**
- **A new ADR number, 0056.** ADR 0052 says later parts add sections to it unless, like part 4, they add a feature key; /feature-change step 3 asks for a new ADR. 0055 is claimed by `feat/reports-api`. The number is checked again before the docs commit, and every reference moves together if it is taken.
- **No new Nest module.** The two controllers and services join `PlatformModule`, so `app.module.ts` (which the reports branch edits) is untouched.
- **`admin.billing` has status `demo`,** like every key that moved to the API with demo parity, both products, the Platform module, and no permission key: writes are the platform owner role's. `admin.access` is retitled "Platform admin: companies, modules and ceilings" (a /feature-change step-6 change; key, screens and row otherwise unchanged; the title is read nowhere else).
- **`featureForPath` still attributes `/admin/plans` to `admin.access`** (a `/*` wildcard outranks an exact path). Each new admin page checks `admin.billing` itself; nothing under /admin uses `pathOn`.
- **The demo has no life cycle** (ADR 0054). A status change shows in the console and its audit log only; the demo company's own side keeps working.
- **The whole Flooring demo project runs in CI only.** Locally: the touched demo specs, the axe, console and responsive specs, the whole HR project, and the whole api-mode suite. CI's `e2e` job runs both demo projects in full before the self-merge. The reason: one 8 GB Mac shared with the reports build, and the merge gate already requires it.
- **`[skip ci]`:** stage commits may carry it, but the head commit never does, so `verify` and `e2e` run when the PR is marked ready.

**The code was checked against the plan.** No contradiction was found at the plan stage. Any one found while building takes the safer reading and is noted for the docs stage.

## Owner questions (new in part 2; earlier ones still stand)
These are numbers 34 to 47 in docs/specs/platform-admin.md, "Waiting for the owner". Questions 1 (the admin host), 2 (using a support grant), 4 (the company's own audit log), 7 (billing) and 11 (stale saves) stay open.

34. **Suspending or cancelling a company that never had a plan.** Keep refusing (taken; the stop-gap is switching its modules off on its Access page), or change the access rule so a suspended or cancelled company with no rows keeps its products' modules, read only (a core/access change)?
35. **Reinstate's status.** `active` when the company ever paid, else `trial` (taken; a company suspended from `past_due` comes back `active` and loses its overdue notice when its rows are current), or the exact status before the suspension, read from its audit row?
36. **Reinstate after cancel:** allowed (taken). Should cancel be final?
37. **Cancelling a never-paid suspended company** when it would restart its read-only days: refused (taken). Confirm.
38. **A plan in use keeps its modules and limits** (taken). Or should a plan change apply to every company on it at once, after a confirmation?
39. **Prices:** required and typed, 0.00 allowed as typed, no "none" without a migration, no yearly = 10 x monthly rule. Confirm, and say what a $0 plan means (question 7).
40. **Unlimited plans and employee bands:** not creatable (taken). A plan with no limits row, only possible by SQL, means no limit today.
41. **Reasons on status and plan entries:** the owner role and the author see them; the support role sees "Reason hidden" (taken). Confirm.
42. **Should the company's Owner be emailed,** or see an entry in the company's own audit log, when it is suspended, reinstated or cancelled?
43. **The new key `admin.billing`:** confirm status `demo`, both products, the Platform module and writes by the owner role only; and the retitle of `admin.access` to "Platform admin: companies, modules and ceilings". The /feature-change step-2 impact summary is in the PR body and ADR 0056.
44. **Retiring a plan changes nothing today,** because subscriptions can't be created yet. Should retired plans be hidden from the console's list by default?
45. **A plan is never deleted and its key never reused.** Confirm.
46. **Plan edits:** the last save wins under the plan's lock, and both are audited (taken). Should plan edits also carry what the admin saw, as status actions now do (and should the access PATCH, question 11)?
47. **Audit history while `admin.billing` is off:** the seven actions' rows stay listed, and only the filter stops offering them (taken). Should their rows be hidden too?

## Status of this log
Written in stage 0. The outcome, the commands run with their results, the decisions taken while building and what is left are added at handoff.
