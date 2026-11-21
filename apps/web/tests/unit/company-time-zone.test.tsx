import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntry } from "@workspace/shared";
import { toCsv } from "@/components/data-table/csv";
import { clockedInText } from "@/features/my/clock-line";
import { auditLogColumns } from "@/features/settings/audit-log-page";
import { CompanyDay } from "@/lib/api/company-day";
import { formatClockTime, formatWhen } from "@/lib/moments";

/**
 * Every time in the company's time zone (ADR 0064; click-through #57 and #66). The browser runs in
 * Tokyo here, so a moment shown in the browser's zone, or as UTC, would fail every test.
 */

const DENVER = "America/Denver";
const zoneBefore = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Asia/Tokyo";
});
afterAll(() => {
  if (zoneBefore === undefined) delete process.env.TZ;
  else process.env.TZ = zoneBefore;
});

const entry: AuditEntry = {
  id: "a1",
  // #57: written at 14:56 UTC, which is 07:56 in Denver.
  at: "2026-11-21T14:56:00.000Z",
  actorName: "Dana Whitfield",
  actorRole: "Owner",
  category: "settings",
  action: "Changed company profile",
  target: "Company profile",
  before: null,
  after: "ein: 84-1234567",
};

const denverFormat = (iso: string, withTime = false) =>
  formatWhen(iso, { pattern: "MMM d, yyyy", zone: DENVER, withTime });

describe("the formatter for moments on screens", () => {
  it("shows an instant on the company's clock with the zone named, in 12-hour time", () => {
    expect(denverFormat("2026-11-21T14:56:00.000Z", true)).toBe("Nov 21, 2026, 7:56 AM MST");
    expect(formatWhen("2026-07-01T21:04:00.000Z", { pattern: "MM/dd/yyyy", zone: DENVER, withTime: true })).toBe(
      "07/01/2026, 3:04 PM MDT",
    );
  });

  it("dates a moment on the company's day, and never shifts a calendar date", () => {
    // 03:30 UTC on the 22nd is still the evening of the 21st in Denver.
    expect(denverFormat("2026-11-22T03:30:00.000Z")).toBe("Nov 21, 2026");
    expect(denverFormat("2026-11-22")).toBe("Nov 22, 2026");
    expect(denverFormat("2026-11-22", true)).toBe("Nov 22, 2026");
  });

  it("reads DemoStore's wall time with no mark as the company's own clock", () => {
    expect(denverFormat("2026-11-21T07:56", true)).toBe("Nov 21, 2026, 7:56 AM MST");
  });

  it("writes the time alone with the zone", () => {
    expect(formatClockTime("2026-11-21T14:04:00.000Z", DENVER)).toBe("7:04 AM MST");
  });
});

describe("the audit log row", () => {
  it("renders When in the company's zone with its label, not UTC and not the browser's zone", () => {
    const when = auditLogColumns(denverFormat).find((c) => c.id === "at")!;
    const html = renderToStaticMarkup(<>{when.cell!(entry, { delta: 0 })}</>);
    expect(html).toBe("Nov 21, 2026, 7:56 AM MST");
  });

  it("exports When as ISO 8601 with the company's offset", () => {
    const csv = toCsv([entry], auditLogColumns(denverFormat), DENVER);
    expect(csv.split("\n")[1]).toMatch(/^2026-11-21T07:56:00-07:00,Dana Whitfield,/);
  });
});

describe("the portal's clock line", () => {
  it("says when the person clocked in on the company's clock (#66: it said 15:04, UTC in 24-hour form)", () => {
    expect(clockedInText("2026-11-21T15:04:00.000Z", DENVER)).toBe("Clocked in at 8:04 AM MST");
    expect(clockedInText(null, DENVER)).toBe("You are not clocked in.");
  });
});

describe("the zone the api client shows moments in", () => {
  it("is none until GET /company names one, then the company's", () => {
    const day = new CompanyDay();
    expect(day.timeZone()).toBeNull();
    day.learn(DENVER);
    expect(day.timeZone()).toBe(DENVER);
    day.learn("Mars/Olympus_Mons");
    expect(day.timeZone()).toBeNull();
  });
});
