# 2026-11-21 18:53, A: every time in the company's time zone

## Goal

Owner decision 5 (ADR 0061): show every time in the company's zone with the zone named where it matters. Closes click-through #57 (audit log in UTC with no label) and #66 ("Clocked in at 15:04"), and P6 / F-r. Branch `feat/web-company-time-zone`.

## What changed

- `packages/shared/src/calendar/moments.ts`: `momentInZone`, `clockText` (12-hour), `momentText`, `momentIso` (exports), `calendarDateText`, `utcMinuteAsInstant`.
- API: every moment goes out as an instant with `Z` (`instantOf`, renamed from `minuteOf`; inventory and purchasing stamps; audit log; commission approval; contract signing; timesheet history). Legacy JSON rows (timesheet history, contract signature) are answered with the mark added; nothing stored is rewritten.
- Web: `formatWhen` (lib/moments.ts) behind `useFormatDate`; `useTimeZone` reads the new client-local `api.timeZone()` (api mode: `CompanyDay`'s zone from `GET /company`; demo: the open company's region zone; the platform console: the browser's zone, named). The portal clock line (`clockedInText`), the contract signature line, moment dates that were sliced to a UTC day, meeting times in 12-hour form, CSV exports with the company's offset, invoice and receipt PDFs through the same formatter.
- `meetingWhenText(start, zone)`: "Nov 19, 2026 at 8:30 AM MST" (meetings.md "Emails" updated).
- Docs: ADR 0064, blueprint-delta row, api-contract "Bodies", meetings.md, coverage.md regenerated.

## Checks run

See the PR body for the exact counts.

## Open questions

- Dense lists keep the zone label (ADR 0064 states the rule); the owner may prefer dropping it where a header names the zone.
- The Outbox row's "When" in api mode comes from the API's `createdAt`, which already had `Z`; now it is shown in the company's zone instead of the browser's.
