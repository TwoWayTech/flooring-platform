# Session 2026-11-20 16:30, A (Claude): `today()` in the company's time zone, from GET /company

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-today`, branch `feat/web-company-today`, cut from `origin/feat/inventory-stock-rules-api` (PR #66, head `f3e9136`) and stacked on it. The other checkouts belong to others and are not touched.

**Owner's queue:** item 2's last item, "`today()` in the company's time zone" (STATUS "The rest of item 2"; the follow-up "The company's day on the web client"; part 3a's "The quote builder previews with the browser's day").

## Prompt (orchestrator, summarised)

- In api mode `today()` is the company's day in `GET /company`'s `company.timeZone`; DemoStore computes its day per call (not fixed when the store is built) in the company's zone too. The day rolls over at the company's midnight in a tab left open. Before the company is known, fall back sensibly and record it.
- Reuse the shared company-day helper rather than duplicate logic. Tests with a fake clock around midnight in Denver against a browser in Tokyo or UTC; unit tests for DemoStore and the api client; one api-mode Playwright check with a far-away `timezoneId` if feasible.
- Decisions in docs/blueprint-delta.md (row dated 2026-11-20) and the relevant ADR section. STATUS notes only through the "For STATUS" block.
- Commit and push after every step; no server or Playwright run until the orchestrator frees ports 3000/4000; a fresh security reviewer each round until clean; no PR, merge, STATUS or BRANCHES edit.

## What the docs and code say

- STATUS: `api.today()` is the browser's day in api mode too (DemoStore's `todayIso = format(new Date())`, fixed when the store is built); about 55 screen call sites use it for default dates. A browser west or east of the company gets the company's tomorrow (or yesterday) for part of the day; the API refuses a future-dated expense, and the quote builder previews tax with the wrong day. `playwright.api.config.ts` runs the browser in America/Denver as a workaround.
- ADR 0051 "GET /company", "The company's day": `GET /company` carries `company.timeZone` (`tenants.time_zone`, the zone `companyClock` uses); `today()` is synchronous and runs before the answer; DemoStore's fixtures are shifted to the browser's day; the task has to settle both.
- ADR 0059 part 2b (D2, D3, D14) and the owner's answer of 2026-11-20: the zone is answered from control `tenants.time_zone` and is read only in both modes, so it can't change while a tab is open.
- The API's day: `dayIn(moment, zone)` in `apps/api/src/modules/sales/sales-common.ts` (Intl `en-CA`), used by `companyClock`. packages/shared has `instantToZoned(instant, zone)` in `calendar/zones.ts` (the wall clock a zone shows, "YYYY-MM-DDTHH:mm"), but no day helper.
- The shell (`WorkspaceData`) renders no screen until `getWorkspace()` (GET /company) has answered, so screens never call `today()` before the zone is known in api mode; only the sign-in and platform pages can.
- Three tax-tab placeholders date a new rule with `new Date().toISOString().slice(0, 10)` (the UTC day); the save re-dates it, but the draft shows the UTC day.
- The seeded companies' control zone is the fixture's own (`packages/db/src/seed/control.ts`), so Summit is America/Denver in both modes.

## Plan (decisions D1…)

- **D1. One shared day helper.** `dayInZone(moment, zone)` in `packages/shared/src/calendar/zones.ts`, built on `instantToZoned`; the API's `dayIn` becomes that helper (no second Intl formatter), so the web and the API read a day the same way.
- **D2. Api mode: `today()` is routed** in `API_METHODS`. A small `CompanyDay` (`apps/web/src/lib/api/http/company-day.ts`) learns the zone from every `GET /company` answer (`getWorkspace` and the people list) and computes the day on every call from the clock, so it rolls over at the company's midnight. A zone Intl doesn't know is not learned.
- **D3. The fallback** before the zone is known (sign-in, the platform pages, a refused first read) is the browser's own day, as before; the shell shows no company screen until `GET /company` has answered, so no company form defaults from it.
- **D4. DemoStore** drops `todayIso`. `today()` is the open company's day in its stored `localization.region.timeZone` (read only since part 2b), computed per call, or the browser's day with no company open (the platform console). Its fixtures are shifted to the company's own day when they load, and its "now" stamps are the company's wall clock (`instantToZoned`), so a record made today never carries tomorrow's stamp. In api mode the DemoStore-served modules use the fixture company's zone, which the seed copies into control.
- **D5. The tax tab's three placeholders** use `api.today()` rather than the UTC day.
- **D6. Tests:** shared unit tests for `dayInZone` (Denver around midnight, Tokyo, UTC, DST); web unit tests for `CompanyDay`, the routed `today()` and DemoStore with Vitest fake timers around midnight in Denver while the process runs in Asia/Tokyo and UTC; demo e2e helpers compute Summit's day (America/Denver) and the demo Playwright browser runs in Denver, as the api config does; one api-mode Playwright spec in `Pacific/Kiritimati` that checks the expense form's default date is Denver's day and records it.
- **D7. Docs:** a blueprint-delta row dated 2026-11-20, ADR 0051 "GET /company" gets a dated section "the company's day", api-contract.md unchanged (no route change).

## Steps

1. Plan (this log).
2. `614e14f` **Shared helper.** `dayInZone` and `isKnownTimeZone` in `packages/shared/src/calendar/zones.ts` (tests: Denver's evening against Tokyo and UTC, the exact midnight, summer time, Intl agreement for the seven meeting zones across a year, an unknown zone). The API's `dayIn` is now `dayInZone` (`apps/api/test/company-day.test.ts` unchanged and green).
3. `5d4d635` **The web.**
   - `apps/web/src/lib/api/company-day.ts`: `browserDay`, `CompanyDay` (`learn`, `today`) and `companyDayOf(client)`, one per api-mode client (a WeakMap keyed by its demo store, since the routes are built per client from the static `API_METHODS`).
   - `api-methods.ts`: `today` routed; `getWorkspace` and the people list read `GET /company` through `companyAnswer`, which learns the zone. `api-rereads.test.ts` gains the kind `local` (sends nothing, asks no re-read) for `today`.
   - `demo/store.ts`: `todayIso` removed; `today()`, `dayOf(db)`, `stampOf(db)` (the company's wall clock replaces `nowStamp`); fixtures shifted to the company's own day; the quote status and conversion read the day once per action; the platform's billing, standing and console keep the browser's day.
   - The Sales tax tab's three placeholders use `api.today()`.
   - `tests/unit/company-day.test.ts` (CD1 to CD5, AD1 to AD6, DD1 to DD4): fake clock at 23:30 and 00:30 in Denver, the process in Tokyo, UTC or Los Angeles. **Red first:** with the old DemoStore DD2, DD3 and DD4 fail; with `today` unrouted the six AD tests fail.
4. `f9ef2f3` **E2E (not run yet: the ports belong to another builder).**
   - New `tests/e2e-api/company-day.spec.ts`: the browser on Pacific/Kiritimati (UTC+14); a new expense's Date is Denver's day (`companyToday()`), and recording it succeeds.
   - Demo: `playwright.config.ts` runs the browser in America/Denver (as the api config); `helpers.ts` gains `SUMMIT_ZONE` and `summitDay(offset)`; `dashboard`, `flows-batch3`, `hr-workspace`, `credit-notes`, `meetings` and `settings` specs compute Summit's day with it instead of the test machine's.
   - `playwright.api.config.ts`: the Denver zone stays (the specs' own clocks); its comment no longer calls it a workaround.
5. `4f41751` **Docs.** ADR 0051 "2026-11-20: the company's day on the web"; blueprint-delta row (2026-11-20); docs/api-contract.md's `today()` row; settings-and-permissions.md drops the known limit "The quote builder's tax preview uses the browser's day"; meetings.md's demo-only line names the company's day.
