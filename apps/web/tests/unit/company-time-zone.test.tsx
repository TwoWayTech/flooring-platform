import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoiceLedger, type AuditEntry, type CompanyAnswer } from "@workspace/shared";
import { toCsv } from "@/components/data-table/csv";
import { buildInvoiceModel } from "@/features/invoices/invoice-model";
import { clockedInText } from "@/features/my/clock-line";
import { auditLogColumns } from "@/features/settings/audit-log-page";
import type { FileStore } from "@/lib/api/demo/file-store";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import { DemoStore } from "@/lib/api/demo/store";
import { workspaceFromAnswer } from "@/lib/api/http/company-answer";
import { formatClockTime, formatWhen } from "@/lib/moments";
import { zoneOf } from "@/lib/use-format-date";

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

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A GET /company answer with only what the workspace facts read filled in. */
function answerIn(timeZone: string): CompanyAnswer {
  return {
    company: {
      id: "0195f3a2-7b1c-7d4e-8f00-0000000000c1",
      slug: "summit",
      name: "Summit Floor Co.",
      city: "Denver",
      state: "CO",
      timeZone,
      modules: ["platform", "core"],
      ceiling: null,
      branches: [],
    },
    me: {
      id: "0195f3a2-7b1c-7d4e-8f00-0000000000a3",
      companyId: "0195f3a2-7b1c-7d4e-8f00-0000000000c1" as CompanyAnswer["me"]["companyId"],
      name: "Priya Natarajan",
      email: "priya@example.test",
      title: "",
      roleIds: [],
      branchId: "",
      status: "active",
      mfaEnrolled: false,
      lastLoginAt: null,
      employeeId: null,
      defaultLocationId: null,
    },
    roles: [],
    access: { permissions: [], dataScope: "own", isOwner: false },
    people: [],
  };
}

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

describe("CSV moments", () => {
  type Row = { start: string; zone: string; at: string };
  const rows: Row[] = [{ start: "2026-11-25T14:00", zone: "America/Chicago", at: "2026-11-25T21:00:00.000Z" }];

  it("export a meeting's wall time with its own zone's offset when the column names it", () => {
    const csv = toCsv(
      rows,
      [
        { id: "start", header: "Start", value: (r) => r.start, timeZone: (r) => r.zone },
        { id: "at", header: "At", value: (r) => r.at, timeZone: (r) => r.zone },
      ],
      DENVER,
    );
    // The wall time stays 14:00 Chicago; a marked instant is still written on the company's clock.
    expect(csv.split("\n")[1]).toBe("2026-11-25T14:00:00-06:00,2026-11-25T14:00:00-07:00");
  });

  it("read an unmarked wall time as the company's clock when the column names no zone", () => {
    const csv = toCsv(rows, [{ id: "start", header: "Start", value: (r) => r.start }], DENVER);
    expect(csv.split("\n")[1]).toBe("2026-11-25T14:00:00-07:00");
  });
});

describe("the portal's clock line", () => {
  it("says when the person clocked in on the company's clock (#66: it said 15:04, UTC in 24-hour form)", () => {
    expect(clockedInText("2026-11-21T15:04:00.000Z", DENVER)).toBe("Clocked in at 8:04 AM MST");
    expect(clockedInText(null, DENVER)).toBe("You are not clocked in.");
  });
});

describe("the zone screens show moments in", () => {
  it("is GET /company's zone in the workspace facts, and none for a zone Intl doesn't know", () => {
    expect(workspaceFromAnswer(answerIn(DENVER)).timeZone).toBe(DENVER);
    expect(workspaceFromAnswer(answerIn("Mars/Olympus_Mons")).timeZone).toBeNull();
  });

  it("is the workspace's, else the browser's, named (the platform console)", () => {
    expect(zoneOf({ timeZone: DENVER })).toBe(DENVER);
    expect(zoneOf({ timeZone: null })).toBe("Asia/Tokyo");
    expect(zoneOf(null)).toBe("Asia/Tokyo");
    expect(formatClockTime("2026-11-21T14:04:00.000Z", zoneOf(null))).toBe("11:04 PM GMT+9");
  });

  it("is DemoStore's open company zone in demo mode", async () => {
    const store = new DemoStore(noFiles);
    await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
    expect((await store.getWorkspace()).timeZone).toBe(DENVER);
  });
});

describe("invoice documents", () => {
  it("print a moment on the zone the screens use, not the settings copy's zone", async () => {
    const summit = await loadCompanyFixtures("summit");
    const invoice = summit.invoices[0]!;
    const customer = summit.customers.find((c) => c.id === invoice.customerId)!;
    const ledger = {
      ...invoiceLedger(invoice, { payments: [], adjustments: [] }, invoice.issuedAt),
      state: "paid" as const,
      // 03:30 UTC on the 22nd: still the 21st in Denver, already the 22nd in the stale copy's Tokyo.
      paidAt: "2026-11-22T03:30:00.000Z",
    };
    const stale = {
      ...summit.settings,
      localization: {
        ...summit.settings.localization,
        region: { ...summit.settings.localization.region, timeZone: "Asia/Tokyo", dateFormat: "yyyy-MM-dd" as const },
      },
    };
    const model = buildInvoiceModel(invoice, ledger, customer, undefined, [], stale, DENVER);
    expect(model.paidOn).toBe("2026-11-21");
  });
});
