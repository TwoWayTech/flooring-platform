# ADR 0064: Every time in the company's time zone

- **Status:** accepted, 2026-11-21. Owner decision 5 of [ADR 0061](0061-owner-decisions-after-click-through.md).
- **Closes:** click-through #57 (the audit log showed 2:56 PM, UTC with no zone, for a change made at 07:56 in the company's Denver zone, while the Outbox showed the browser's time), #66 ("Clocked in at 15:04", UTC in 24-hour form) and the long-open P6 / F-r (moments sent with no zone mark; docs/STATUS.md, docs/whole-product-check.md).

## Context

The API sent most moments as `toISOString().slice(0, 16)`, UTC minutes with no mark. The web read them with date-fns `parseISO`, which takes a time with no mark as the browser's local time, so every such moment was off by the browser's offset and named no zone. Some answers (Outbox, import history, support access, the platform console) already sent full instants with `Z`, which the web showed in the browser's zone. DemoStore stamps its records with the company's wall clock and no mark (`stampOf`). PR #69 had already made `today()` the company's day (`GET /company`'s `company.timeZone`).

## Decision

### On the wire

- **A moment is an ISO 8601 instant in UTC with its `Z` mark**, `2026-11-21T14:56:00.000Z`. The API's record helpers (`instantOf` in sales/invoice-records, used by every module's loader, and the audit log, inventory, purchasing, commission approval, contract signing and timesheet history) all send this.
- **Stored data is not changed.** JSON columns written before this ADR (a timesheet's `history`, a contract's `signature`) hold UTC minutes with no mark. The loaders answer them with the mark added (`utcMinuteAsInstant`); new rows are written with the mark. No migration and no backfill.
- **A wall time with no mark**, `YYYY-MM-DDTHH:mm`, is already the clock of the zone it belongs to: DemoStore's stamps (the open company's zone), and meeting times (the meeting's zone; api-contract "Meetings", Times). It is never read as UTC on the web.
- **A calendar date**, `YYYY-MM-DD` (due dates, pay periods, issue dates), is not a moment and is never shifted.
- The first 16 characters of the new form are the same as the old, so code that slices a moment (`slice(0, 10)` for a UTC day in a rule) behaves as before.

### One formatter

- `packages/shared/src/calendar/moments.ts`: `momentInZone` reads either form on a zone's clock (wall time, abbreviation, offset; the autumn overlap is the earlier instant, the spring gap daylight time, as `zonedToInstantLenient`), `clockText` writes a 12-hour time ("7:56 AM"), `momentText` the email form, `momentIso` the export form.
- `apps/web/src/lib/moments.ts` `formatWhen` and the hook `useFormatDate` (which every screen already used) apply the company's date format to the moment's **company day**, and with `withTime` add the 12-hour time and the zone: **"Nov 21, 2026, 7:56 AM MST"**. A date shown without its time is also the company's day, not the UTC or browser day.
- The zone is the workspace's `timeZone` (`useTimeZone`): in api mode `GET /company`'s `company.timeZone`, `tenants.time_zone`, the zone `today()` reads; in the demo the open company's `localization.region.timeZone`. The workspace is React state the shell re-reads, so every screen follows a change of company or zone, and no company screen renders before it exists. Every person reads `GET /company`, so a person who can't read Settings still gets the company's zone (Settings' region copy can be DemoStore's for them).
- Invoice and receipt PDFs take that same zone as a parameter (`buildInvoiceModel`, `buildReceiptModel`), never the settings copy.
- A rate changed on a document where no rule applies is valid from the company's day the change was made (`withOverride` reads `override.at` in the company's zone), not the UTC day.

### Where the zone is named

- **Every time of day shown names the zone**: the audit log, the Outbox, import history, a roll's cuts, support access requests and their end, the platform audit log, the portal's clock line ("Clocked in at 7:04 AM MST"), and a contract's recorded signature ("…, Nov 21, 2026, 7:56 AM MST.").
- Dense lists keep the label too. A list may drop it only if its column header names the zone; none does today. This keeps one rule and costs a few characters.
- **Dates alone name no zone**: they are the company's day.
- **Meeting times** keep their own display (the calendar and drawer read the meeting's wall time); they now use 12-hour time everywhere, the portal's "My meetings" and the drawer's "Proposes …" included. Meetings are booked in the company's zone (ADR 0051), so their times are company times.
- 12-hour time is used for en-US throughout; no screen writes a 24-hour time any more.

### Exports and documents

- **CSV exports write a moment as ISO 8601 with the company's offset**, `2026-11-21T07:56:00-07:00`, so a spreadsheet keeps the exact instant and still reads the company's clock (`toCsv` with a zone; the DataTable export and the reports hub pass it). Calendar dates and every other value are exported as stored. A wall time with no mark is read as the company's clock unless its column names its own zone (`ColumnSpec.timeZone`): a column of meeting times must name the meeting's `timeZone`, so it exports with that zone's offset. No table lists meeting times today.
- **Invoice and receipt PDFs** print dates only; a moment on them (paid on) is printed as the company's day through the same formatter.
- **Emails**: the only template value that carries a time is `meeting.when`, now **"Nov 19, 2026 at 8:30 AM MST"** in the meeting's zone (`meetingWhenText(start, zone)`; meetings.md "Emails", which said `YYYY-MM-DD at HH:mm` with no zone). Every other template value is a date or a period.
- **ICS** files already carry the zone: `DTSTART;TZID=…` with a `VTIMEZONE` block (ADR 0051). Unchanged.

### The platform console

The console belongs to no company, so it shows **the browser's own zone, named** ("Nov 21, 2026, 4:56 PM CET"), with its "MMM d, yyyy" date format. A platform admin works across companies in many zones; their own clock with the zone named is the least surprising, and the label makes it unambiguous. UTC was considered and rejected: it is right for no reader.

## Consequences

- The API's answers change form (a `Z` and seconds) but not meaning; api-contract.md "Bodies" says so.
- A JSON column may hold both forms; the loaders read both, and the formatter reads both.
- The demo and api mode render the same: both through `formatWhen`, in the company's zone.
- Text built by the API with times in it must go through `packages/shared` moments; `meetingWhenText` is the only one today.
