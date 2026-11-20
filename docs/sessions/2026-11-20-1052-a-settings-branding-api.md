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

(filled in as the build goes)

## Owner questions (none blocks; each with its safest default taken)

- **Q1. The logo on the API.** Taken: left out; the monogram stands in on the API, and the page offers the upload only in the demo. StorageProvider and an upload pattern exist (expense receipts, payment proofs), but the logo is read by every member's shell, by the public login page before sign-in and by the PDFs, so it needs a serving route (signed URL or proxied bytes), public reads for the login page, and SVG handling (an uploaded SVG can carry script; PNG and JPEG only, or sanitize). Build it as its own part?
- **Q2. The display name and the sign-up name.** Taken: Branding changes `tenant_branding.display_name` only; `tenants.name` (the console's company name) keeps what sign-up wrote. Sync it too?
- **Q3. A step-up on every branding save.** Taken: always, as approved, although `settings.branding.manage` is not an MFA key (a custom role without a factor gets `step_up_mfa_required`; the Owner has MFA). Confirm.

## Commands run

| Step | Command | Result |
| --- | --- | --- |

## For STATUS

(at the end)

## Reviewer summary

(at the end)
