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
6. **Review rounds.** Each round used a fresh read-only `security-reviewer`. Every round was PASS with no blocking finding; each Low finding was either fixed with tests or recorded.
   - **Round 1** (`648d488`):
     - When a later answer names a zone Intl doesn't know, the zone is dropped instead of keeping another company's (CD4 reworded, AD7).
     - The routed `closeCompany` forgets the zone (CD6, AD8).
     - `wallClockAt` is built with `setUTCFullYear`, so years 0 to 99 read correctly.
     - The dead `todayIn` in `sales-common.ts` is removed.
     - `dayInZone` is tested against Intl every 13 minutes for UTC, Kolkata, Kathmandu, Lord Howe, St John's and Chatham, and for the last millisecond before midnight, year 50 and an invalid date.
     - The e2e spec notes the hours in which it proves nothing new.
   - **Round 2** (`1869f8c`):
     - The routed `openCompany` forgets the zone before DemoStore opens (AD9).
     - `answered(db)` reads the day of the db it answers.
   - **Round 3** (`6b5e4b0`):
     - One fallback serves the client and DemoStore (`dayInOrBrowser`, `clockInOrBrowser`; CD7).
     - The known limits are recorded in ADR 0051.
   - **Round 4** (`dfa9f96`):
     - `isKnownTimeZone` reuses the cached formatter.
     - The day is the first ten characters of the clock.
     - The billing page and a user change within the same company are recorded.
   - **Round 5:** clean. Two Low notes that can't be reached today stay as follow-ups:
     - `dayInZone` formats a year past 9999 as `+010000` (every caller passes a moment from the server's clock).
     - The formatter cache is keyed by the raw zone string (zones come only from the control row).

## Decisions

- **D1 to D7** as planned above, with the review's changes: an unknown zone, `openCompany` and `closeCompany` all drop the zone (D2, D3).
- **Sign-out isn't touched.** It is session code, which needs the owner's approval to change. The next `openCompany` drops the zone, so only the sign-in page may show the last company's day. Recorded in ADR 0051's known limits.
- **The demo Playwright browser runs in America/Denver,** like the api config, and the demo specs compute Summit's day with `summitDay()`. Cross-zone behaviour is proven by the fake-clock unit tests and the Kiritimati api spec.
- **DemoStore's platform dates keep the browser's day** (billing, standing, console), because the platform fixtures are shifted to it.

## Checks (local, Windows laptop)

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass: shared 1,236, web 495, API 128, db 18, providers 11 |
| API integration (`vitest --project integration --maxWorkers=3`) | 963 of 963 at `a85c87b`, and again 963 of 963 at `1869f8c` (after the last API-side change) |
| Playwright api mode (with `company-day.spec.ts`) | not run: ports 3000/4000 belong to another builder |
| Playwright demo (expenses, timesheets, time off, quotes, invoices, plus the six changed specs) | not run, for the same reason |
| Red first | the old DemoStore fails DD2, DD3 and DD4; an unrouted `today` fails the six AD tests |

## What is left

- Run the e2e once the ports are free:
  - build in api mode and run the whole api-mode suite with 1 worker on a fresh throwaway Postgres 16 on port 5434 (migrate, seed twice);
  - then build in demo mode and run, with 2 workers, the date-heavy demo specs and the six changed ones.
- Then `/review`, the draft PR (stacked on PR #66), and STATUS and BRANCHES (the orchestrator's).

## Next prompt

> Worktree `C:\dev\fp-today`, branch `feat/web-company-today`. The ports are free. Run the api-mode Playwright suite (fresh Postgres 16 on 5434, migrate, seed twice, 1 worker). Run the demo specs `expenses`, `timesheets`, `time-off`, `quotes`, `invoices`, `dashboard`, `flows-batch3`, `hr-workspace`, `credit-notes`, `meetings` and `settings` with 2 workers. Fix failures with tests, and add the results to the session log's checks table.

## For STATUS

The orchestrator applies these at handoff. Re-read STATUS first and anchor on the quoted text.

- **"The rest of item 2":** replace the bullet "`today()` in the company's time zone. It should read `GET /company`'s `company.timeZone`. DemoStore's `todayIso` is fixed when the store is built (#53's session log)." with "`today()` in the company's time zone: built (`feat/web-company-today`, stacked on PR #66)."
- **Remove** the follow-up "**The company's day on the web client:** `api.today()` is the browser's day in api mode too …" and its three sub-bullets (the CI failure, the api config's Denver zone, the fix). It is done:
  - `today()` is the company's day in api mode (`GET /company`'s `company.timeZone`) and in DemoStore (the open company's zone), worked out on every call;
  - the api config keeps Denver for the specs' own clocks, and `company-day.spec.ts` runs from Pacific/Kiritimati.
- **Settings part 3a follow-ups:** remove "**The quote builder previews with the browser's day** (`api.today()`) …" (fixed).
- **"Done"** (on merge): "`today()` in the company's time zone (queue item 2's last item; ADR 0051, 2026-11-20 section "the company's day on the web"). The web's `today()` is the company's day in its own zone, worked out on every call so it rolls over at the company's midnight. In api mode it uses the zone of every `GET /company` answer; the zone is dropped when a company opens or closes, or when an answer names a zone Intl doesn't know, and the browser's day applies until the next answer. In DemoStore it uses the open company's zone, with the fixtures shifted to that day and records stamped with the company's clock. One shared `dayInZone` serves the API's `dayIn` and the web. The Sales tax tab's placeholders start at `api.today()`. No route, schema, migration or dependency change. Checks: lint, typecheck, unit tests (shared 1,236, web 495, API 128, db 18, providers 11), API integration 963 of 963; <the e2e results>; five security review rounds, all PASS."
- **New follow-ups (Low, from the review):**
  - In a demo tab left open past the company's midnight, the demo's seeded "today" records sit a day behind until a reload, because fixtures are shifted only once, when they load.
  - In api mode, screens still on DemoStore judge dates on the fixture company's zone (the same as the seed's). A tenant set up in another zone could see a one-day difference there until its module moves.
  - Sign-out doesn't clear the company's zone (session code); the next `openCompany` does.
  - `report-records.ts` `minuteIn` duplicates `instantToZoned`. `purchasing-records.ts` and `sales-records.ts` read some timestamps as UTC days rather than the company's day (not confirmed as a problem).
  - `dayInZone` formats a year past 9999 as `+010000` (unreachable). The zone formatter cache is keyed by the raw zone string.

## Reviewer summary

Security review of branch `feat/web-company-today` (read-only), diff `f3e9136..HEAD`. There were five rounds, each with a fresh `security-reviewer`. **PASS: no round found a blocking issue.**

- **The server.**
  - The only server-side change: the API's `dayIn`, which `companyClock` uses, now calls the shared `dayInZone`.
  - The tests compare it with the old Intl `en-CA` formatter:
    - across a year in all seven US meeting zones;
    - every 13 minutes in UTC and in zones with half-hour, 45-minute and southern summer-time offsets;
    - at the exact midnight and the last millisecond before it, across daylight saving time, for years below 100, for an invalid date and for an unknown zone.
  - So the API's day is unchanged for every reachable input.
  - `companyClock` still reads the zone from control `tenants` for the session's company.
  - The API takes no day, zone or tenant from the client. Invoices date on `clock.day`, tax versions are stamped with the server's day, dated writes refuse future dates on the company's clock, and `LedgerService` enforces closed periods.
- **The web.**
  - `today()` is the company's day, worked out on every call from the zone in `GET /company`, with one zone per client.
  - The zone is dropped when a company opens or closes, or when an answer names a zone Intl doesn't know. So `today()` never throws and never reads another company's zone.
  - `today()` sends no request and asks for no re-read.
- **DemoStore.** Its day and record stamps follow the open company's zone; the platform's dates keep the browser's day.
- **Fixed in review:**
  - dropping the zone on an unknown zone and on open and close;
  - `setUTCFullYear` for years 0 to 99;
  - the dead `todayIn` removed;
  - one zone-or-browser fallback;
  - cached formatters for known zones.
- **Known limits, recorded in ADR 0051.** None of them reaches the server.
  - Demo fixtures stay on the day they loaded.
  - In api mode, screens still on DemoStore read the fixture company's zone.
  - Sign-out leaves the zone until the next company opens.
  - A `GET /company` still in flight at a company switch isn't checked against the new company.
