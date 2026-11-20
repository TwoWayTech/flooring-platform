# Session 2026-11-20 10:52, A (Claude): Settings part 6, Branding on the API (queue item 2, task 2)

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-6`, branch `feat/settings-branding-api`, based on part 4a (`3c3a04b`, PR #61). The other checkouts (`C:\dev\flooring-platform`, `fp-work`, `fp-work2`, `fp-3b`, `fp-4a`, `fp-4b`, `fp-5`) belong to others and are not touched.

**Settings part 6** (ADR 0059 "Later parts" row 6). The owner approved it on 2026-11-20 (ADR 0059 "2026-11-20: the owner's answers"): saving Settings → Branding writes the control database `tenant_branding` row from a company route, with a step-up and a company `audit_log` row. No plan file: this log holds the plan.

## Prompt (orchestrator, summarised)

- Build `PUT /settings/branding` on part 1's per-section pattern: the shared key, module, page switch, scope `all`, strict Zod body, shared content rules with the same words in both modes, the company only from the verified session, a step-up, one company `audit_log` row with before and after, the control row written through the existing control handle. Answer branding from the control row; keep DemoStore in step; move the page to the API in api mode.
- The logo: leave it out if it needs a new provider capability or a change to packages/providers; keep the safest default and ask the owner.
- No schema change, migration or dependency. No e2e run, `next build` or Playwright (another builder owns ports 3000 and 4000): write the specs and stop before running them.
- Commit after each step; push with `git push -q origin feat/settings-branding-api`. No PR, merge or `gh` write. STATUS and BRANCHES are the orchestrator's.

## Plan (short)

- **D1. The route.** `PUT /settings/branding` in `SettingsController`: key from `SETTINGS_SECTIONS.branding` (`settings.branding.manage`), module `platform` (every company of both products, so no module guard, as profile and numbers), then in the handler the `settings.branding` switch (404), data scope `all` (403), a strict body (400), the shared rule `brandingProblem` (400), a step-up (403 `step_up_required`, after the content checks so a refused value never costs a code), then the save. Answers the branding as saved.
- **D2. The save writes control, audits the company.** `SettingsService.saveBranding`: one control transaction, `SELECT … FOR UPDATE` on the company's live `tenant_branding` row by `tenant.companyId` (TenantGuard's, from the verified session; never a body field); no row is 409 `branding_missing`, nothing created; then only `display_name`, `monogram`, `brand_color`, `pattern`, `default_theme` and `updated_at` change (the session timeouts and the logo, logo-dark and favicon keys in the same row never do); then one company `audit_log` row "Changed branding", target "Branding", `before` and `after` as answered, in a company transaction inside the control one. Plain Drizzle over the existing `CONTROL_DB` handle, no provider-specific SQL.
- **D3. Two databases, one order.** No transaction spans both: the company audit row commits first, then the control row. A control commit that fails after the audit commit leaves an audit row for a change not made (rare: the update already ran under the lock); the other order could leave a change with no audit row, which rule 10 forbids. Recorded as a residual.
- **D4. Shared content rules** (`packages/shared/src/settings/branding-rules.ts`, the same words in both modes, through `settingsSectionProblem`): display name trimmed not blank, at most `BRANDING_NAME_MAX` (80) characters, no line breaks or control characters (it is printed in email subjects and documents); monogram 1 or 2 capital letters or digits; brand colour exactly `#` and six hex digits, then `checkBrandColor`'s contrast (its own words); pattern and default theme one of their options; the logo none or a PNG, SVG or JPEG data URL of at most 300 KB (the demo's limit, moved from the page).
- **D5. The logo stays out of the API** (Q1). `GET /settings` answers `logoDataUrl: null` (the monogram); `PUT` takes only `null` there, with words; the control row's logo keys are never read or written. The page offers the upload only in the demo; in api mode it says the monogram stands in.
- **D6. Who reads it.** `branding` joins `API_SETTINGS_SECTIONS` with readers `everyone`, not hidden by the page switch: the shell paints every screen with it, and invoices, receipts and purchase orders print the name. Read from the control row by the verified tenant's id; a company with no live row gets no `branding` (the web keeps its copy, as a company with no localization row). No property is a `SENSITIVE_FIELDS` name. `GET /company` is unchanged (the shell already reads branding from `getSettings()`).
- **D7. The web.** `settingsFromAnswer` takes `branding`; `updateSettings("branding")` goes to `PUT /settings/branding` with no transport change (`isApiSettingsSection`). The page passes `problem` (the shared rule) and `stepUp`.
- **D8. DemoStore.** `updateSettings("branding")` already runs module, key, switch and scope; the shared rule is added through the dispatcher. Its step-up is the dialog alone, as everywhere in the demo. It keeps the logo.
- **D9. Readers that follow at once:** the login page (`GET /public/branding`), the platform console's directory and the notification emails' company name read the control row already. `tenants.name` (the sign-up name) is not changed (Q2).

## Decisions while building

- **A1. Step-up before the transaction.** It doesn't read the stored row (no Owner-only rule here), so it runs right after the content checks and before the control row is locked; no lock is held while the step-up rows are read.
- **A2. Pattern and theme are Zod enums with the rule's words** (`FLOOR_PATTERNS`, `DEFAULT_THEMES` from the shared rule), so the body's type is `Branding` with no cast; the shared rule checks them again for DemoStore.
- **A3. The logo's API refusal is the body's, not the shared rule's** (`z.null` with `BRANDING_MESSAGES.logoNotOnApi`): the demo keeps logos, so the shared rule allows a small data URL and the API alone takes none. The page in api mode shows the same words in place of the upload (`isDemoMode()`, as `user-menu.tsx` and `step-up-dialog.tsx` do).
- **A4. `CompanySection`** (`Exclude<ApiSettingsSection, "branding">`) types the company-table helpers (`save`, `current`, `valueOf`), so nothing can store branding in the company `settings` table (its `SettingsGroup` type already excludes it).
- **A5. The dispatch harnesses' "unserved section" is now `hr`** (API X2, web X3): branding is served.
- **A6. The API test company `brandco` gets a logo key, a favicon key and a 45-minute idle timeout** before the cases, so a save that touched them, or an answer that read the logo key, would show (BA1, BA3).
- **A7. The mutation runner is Node** (`settings6/mutate.mjs` in the scratchpad), one mutation at a time, each file restored from a saved copy and compared after; API mutations run `settings-branding.int.test.ts` filtered with `-t` to the cases that pin them.
- **A8. No e2e, `next build` or Playwright was run** (another builder owns ports 3000 and 4000). BE1, BS1, BS2 and the demo spec's step-up are written and typecheck and lint clean.

## Owner questions (none blocks; each with its safest default taken)

- **Q1. The logo on the API.** Taken: left out; the monogram stands in on the API, and the page offers the upload only in the demo. StorageProvider and an upload pattern exist (expense receipts, payment proofs), but the logo is read by every member's shell, by the public login page before sign-in and by the PDFs, so it needs a serving route (signed URL or proxied bytes), public reads for the login page, and SVG handling (an uploaded SVG can carry script; PNG and JPEG only, or sanitize). Build it as its own part?
- **Q2. The display name and the sign-up name.** Taken: Branding changes `tenant_branding.display_name` only; `tenants.name` (the console's company name) keeps what sign-up wrote. Sync it too?
- **Q3. A step-up on every branding save.** Taken: always, as approved, although `settings.branding.manage` is not an MFA key (a custom role without a factor gets `step_up_mfa_required`; the Owner has MFA). Confirm.

## Commands run

| Step | Command | Result |
| --- | --- | --- |
| plan | commit `b7cc898` (this log) | pushed |
| shared | `packages/shared: npx vitest run test/branding-rules.test.ts test/settings-sections.test.ts` | 19 passed |
| api | `apps/api: npx vitest run --project integration --maxWorkers=2 test/settings-branding.int.test.ts` | 26 passed (77 s) |
| api | `apps/api: npx vitest run --project unit test/settings-dispatch.test.ts` | 2 passed |
| api | `apps/api: npx vitest run --project integration --maxWorkers=2` settings, settings-branding, isolation, permissions, branding | 5 files, 115 passed |
| web | `apps/web: npx vitest run` demo-settings, settings-answer, settings-dispatch | 35 passed |
| all | `pnpm typecheck`, `pnpm lint` | pass |
| all | `pnpm test` | providers 11, db 18, shared 1203, api 126, web 446 passed |
| code | commit `3bcdb56` (product and unit/API tests) | pushed |
| e2e | specs written, typecheck and ESLint clean; **not run** (A8) | commit `fbc3761`, pushed |
| docs | ADR 0059 section "2026-11-20: part 6" and row 6, api-contract, spec rule 27 and Real build, data-model, FEATURES.md (text only), blueprint-delta row; `features.test.ts` 7 passed; Prettier clean | commit `0893bde`, pushed |
| mutations | `node settings6/mutate.mjs` (BM1 to BM26, Node, one at a time, saved copies restored and compared) | 25 caught at once; BM11 was a wrong mutation (`void tx \|\| record(...)` still records), fixed to `tx && null && record(...)`, then caught by BA3. Every file restored; tree clean |
| api | `apps/api: npx vitest run --project integration --maxWorkers=3` (whole suite) | 43 files: 850 passed, 5 skipped; `california-pay.int.test.ts` failed at file level with no failing test (a hook under load); alone: 5 passed |
| review | fresh read-only security-reviewer, round 1 | PASS, no blocking; three Low (below) |
| fix | round 1 Low 1: invisible format characters refused in the display name; BR2 and BA5 extended; BM27 (the old character class) caught by BR2 and BA5 | branding-rules 8 passed, settings-branding 26 passed |

## Review

**Round 1** (fresh read-only security-reviewer on `3c3a04b..HEAD`): **PASS, no blocking findings.** Tenancy (the row found only by TenantGuard's `tenant.companyId`; the strict body has no id; BA10), permissions (key, switch, scope, ceiling, guard order), the step-up (always, after the content checks), the audit (one entry; a failed audit rolls back the control write), the written columns and the input handling (colour regex and `brandTokens` only, so no CSS injection; `fromHeader` strips quotes and angle brackets; the API takes no logo) were found sound. Three Low notes:
1. **Invisible format characters in the display name** (bidi overrides, zero-width marks) could spoof the sender name in emails. **Fixed:** `CONTROL_CHARACTERS` also refuses U+200B to U+200F, U+2028 to U+202E, U+2060 to U+2069 and U+FEFF; BR2 and BA5 pin it; BM27 caught.
2. **A company with no live branding row shows DemoStore's branding in api mode** (`answer.branding ?? demo.branding`). Not changed: every section left out of the answer behaves this way (part 1's pattern), provisioning always writes the row, and a save gets 409 with words. Follow-up F1, owner question Q4.
3. **Cross-pool wait:** the branding save holds a control connection while it opens a company transaction; a deadlock needs both pools saturated with opposite orders (unverified). The other settings saves read control (`companyClock`) before their company transaction. Follow-up F2; no change (D3's order keeps every change audited).

**Round 2** (a fresh read-only security-reviewer on the whole diff after the fix): **PASS, no blocking findings.** Two Low notes: (1) the character class still let a few format characters through (U+061C, the soft hyphen, U+180E, U+FFF9 to U+FFFB, tag characters); taken as suggested: `CONTROL_CHARACTERS` is now `/[p{Cc}p{Cf}  ]/u`, and BR2 adds U+061C, the soft hyphen and a tag character, plus ordinary names that must pass (apostrophe, ampersand, accent, no-break space, curly quotes, en dash); settings-branding 26, branding-rules 8 and demo-settings 14 passed; lint clean. (2) D3's audit order, already accepted. Round 2 is the clean round; the follow-up narrowing changes only the shared rule's character class, with tests.

## Independent review (the coordinator's, 2026-11-20): PASS, two should-fixes, both fixed

1. **Medium, the shared control pool.** The save held a control connection and the `FOR UPDATE` on `tenant_branding` while it waited for a company connection, with no lock timeout, so a burst of saves on one step-up grant or a slow company database could drain the control pool (5) and stall sign-in for every tenant. **Fixed:** `saveBranding` runs `select 1` on the company database before it opens the control transaction; inside it, `set local lock_timeout = '5s'`, `statement_timeout = '10s'` and `idle_in_transaction_session_timeout = '10s'` (the import lock's pattern, `import-lock.ts`); a lock not granted (SQLSTATE 55P03, `lockNotAvailable`) answers 409 `branding_busy` with words, nothing written. **BA14:** with the row held by another transaction, a save answers 409 `branding_busy` after 4.5 to 9 s, writes nothing, then succeeds once the row is free. Untested by design: the statement and idle limits (no test makes a control statement run 10 s or holds the transaction idle that long without the company pool saturated) and the `select 1` (a defensive reach).
2. **Low, a failing audit write.** **BA15:** `AuditService.record` spied to throw once: the save answers 500 and the control row and the audit log are unchanged (the control transaction rolls back).
3. **Note 3, audit-then-control ordering:** accepted as built (D3): the company audit entry commits inside the control transaction, so a control commit that fails after it leaves an entry for a change not made, and no change is ever left unaudited.
4. **Note 4, RFC 2047:** whether a non-ASCII display name (for example "Café Floors") is RFC 2047-encoded in the email From display name and subject by the email provider path (`fromHeader`, `notification-rules.ts`) is **unverified**; this part didn't change email code. Follow-up F5.
5. **Note 5:** the coordinator's message named a note 5 to record without giving its text; it is not recorded here, so the orchestrator should add it from the independent review's report.

Mutations BM28 (no `lock_timeout`: BA14 hangs past its timeout), BM29 (no busy mapping: 500) and BM30 (the audit not awaited: the control change commits) are each caught (BA14, BA14, BA15); files restored.

**Fresh review of that delta (`b73c910`): PASS, no blocking.** Three Low notes, taken: the `select 1` comment now says the idle limit, not the check, bounds the wait for a company connection; the three limits are set with `set_config(..., true)` and parameters instead of `sql.raw`; ADR 0059's residual-risk line notes that an audit slower than 10 s ends the control session after the audit committed (D3's accepted gap, slightly likelier). Untested: the idle-limit path (holding all 3 company connections), recorded as follow-up F6.

## E2e (ports free, run at the coordinator's request)

- **Database:** a throwaway `postgres:16-alpine` container on port 5434 (`fp6-e2e-pg`), as CI does: fresh throwaway secrets made in-process by `settings6/run-env.mjs` (never printed, no `.env` read), `pnpm db:seed` twice. The shared PostgreSQL on 5432 was not touched. The container was removed afterwards.
- **Builds, one at a time:** `pnpm --filter api build`, `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`; later `NEXT_PUBLIC_DATA_SOURCE=demo pnpm --filter web build`.
- **Api mode, the whole suite, the config's 1 worker:** `npx playwright test --config playwright.api.config.ts`: **58 passed (7.4 min)**, BE1 among them.
- **Demo, 2 workers:** `E2E_WORKERS=2 npx playwright test branding settings shell roles audit a11y responsive --project=flooring`: **211 passed (5.3 min)**, the branding spec's step-up, BS1 and BS2 among them; `... branding settings shell --project=hr`: **2 passed**.
- No failure, so no code change and no further review. Ports 3000 and 4000 free after each run (`netstat`).
- F4 (e2e not run) is closed.

## Owner questions (added during the build)

- **Q4. A company with no live branding row in api mode** shows the demo's branding (a save answers 409). Taken: as every section left out of the answer. Show neutral product defaults instead?

## For STATUS (the orchestrator applies these; re-read STATUS first and anchor on the quoted text)

- **In progress / next:** Settings part 6, Branding (`feat/settings-branding-api`, stacked on #61).
- **Done (on merge):** "Settings part 6 (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-20 part 6 section). Settings → Branding saves on the API: `PUT /settings/branding` (`settings.branding.manage`, platform, the `settings.branding` switch, scope `all`, strict body, the shared `brandingProblem`, always a step-up) writes the session company's control `tenant_branding` row (name, monogram, colour, pattern, theme only) under a row lock with one company audit entry; `GET /settings` answers branding to every member from that row. No logo on the API yet (the monogram stands in)."
- **Change:** "The shell's branding is still the demo's until Settings part 6" is closed; the unmoved-pages list loses Branding.
- **New follow-ups:** F1 a neutral fallback for a company with no branding row in api mode (review Low 2, Q4); F2 the branding save holds a control connection while it opens a company transaction (review Low 3: check pool sizes, or write the audit on its own connection); F3 the logo on the API (Q1); F4 the api-mode e2e BE1 and the demo branding spec (step-up, BS1, BS2) are written but not run; F5 verify RFC 2047 encoding of a non-ASCII display name in email headers (independent review note 4); F6 a test that holds all company connections and expects a branding save to fail within the idle limit with the control row unchanged.
- **Owner questions:** "Owner questions (Settings part 6; none blocks)" with Q1 to Q4.
- **BRANCHES:** a `feat/settings-branding-api` row: "A (Claude)", "Queue item 2, task 2, Settings part 6: branding on the API (worktree `C:\dev\fp-6`; stacked on #61)", e2e not yet run, "see the branch".

## Reviewer summary (ready to paste)

> Security review (read-only), feat/settings-branding-api, diff 3c3a04b..HEAD: PASS, no blocking issues. `PUT /settings/branding` writes the control `tenant_branding` row only for the verified session's company (TenantGuard's `tenant.companyId`; the strict body has no id; path, query and headers are never read for the company), under `FOR UPDATE`, changing only display_name, monogram, brand_color, pattern, default_theme and updated_at; a missing row is 409 and nothing is created. Guards: `settings.branding.manage` from the shared table (with the ceiling), the `settings.branding` switch (404), data scope `all` (403), a strict Zod body (400), the shared `brandingProblem` (400), then always a step-up through `StepUpService.require`. One company `audit_log` entry (before and after) in a company transaction nested inside the control one, so no change is left unaudited; `@Audited()` prevents a second entry. Colours are `#RRGGBB` and reach CSS only through `brandTokens`; the API takes no logo. Low notes: invisible bidi and zero-width characters in the display name (fixed, with tests); a company with no branding row falls back to the demo copy in api mode (follow-up); a cross-pool connection wait in the save (follow-up). 27 mutations of the protections, each caught. Round 2: PASS; its optional note (Unicode Cc and Cf classes for the display name) was taken, with tests.

## Outcome

Built as planned without the logo (Q1): 11 product files (2 new: `branding-rules.ts`, `branding-row.ts`), unit, API and e2e tests, docs. Every check run passes; the e2e specs are written, not run.
