import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  pendingQuotes,
  quoteActions,
  quoteDraftProblem,
  quoteIsOpen,
  quoteSendProblems,
  quoteState,
  upgradeOverlay,
  type CompanyFixtures,
  type Quote,
} from "../src";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const summit = JSON.parse(readFileSync(`${FIXTURES}summit.json`, "utf8")) as CompanyFixtures;
const TODAY = "2026-11-04";

const quote = (patch: Partial<Quote> = {}): Quote => ({
  ...summit.quotes.find((q) => q.status === "pending")!,
  ...patch,
});

describe("quote statuses (spec B1)", () => {
  it("reads Expired for a pending quote past its expiry date, and only then", () => {
    expect(quoteState(quote({ expiresAt: "2026-11-03" }), TODAY)).toBe("expired");
    expect(quoteState(quote({ expiresAt: TODAY }), TODAY)).toBe("pending");
    expect(quoteState(quote({ expiresAt: null }), TODAY)).toBe("pending");
    expect(quoteState(quote({ status: "accepted", expiresAt: "2026-01-01" }), TODAY)).toBe("accepted");
  });

  it("offers only the next steps of each state", () => {
    expect(quoteActions(quote({ status: "draft" }), TODAY)).toEqual(["send"]);
    expect(quoteActions(quote({ expiresAt: null }), TODAY)).toEqual(["accept", "decline"]);
    expect(quoteActions(quote({ expiresAt: "2026-10-01" }), TODAY)).toEqual(["send", "accept", "decline"]);
    expect(quoteActions(quote({ status: "accepted" }), TODAY)).toEqual(["decline"]);
    expect(quoteActions(quote({ status: "converted" }), TODAY)).toEqual([]);
    expect(quoteActions(quote({ status: "declined" }), TODAY)).toEqual([]);
    expect(quoteIsOpen(quote({ status: "declined" }))).toBe(false);
  });

  it("saves a draft with only a customer", () => {
    expect(quoteDraftProblem({ customerId: "" })).toMatch(/customer/);
    expect(quoteDraftProblem({ customerId: "c1" })).toBeNull();
  });

  it("checks the whole quote before it is sent", () => {
    const empty = quote({
      customerId: "",
      lines: [],
      jobSite: { street: " ", city: "", state: "", zip: "123" },
      locationId: "",
    });
    expect(Object.keys(quoteSendProblems(empty, "2026-11-01", TODAY)).sort()).toEqual(
      ["city", "customer", "expiresAt", "lines", "location", "state", "street", "zip"].sort(),
    );
    expect(quoteSendProblems(quote(), "2026-12-04", TODAY)).toEqual({});
    expect(quoteSendProblems(quote(), null, TODAY)).toEqual({});
  });

  it("sums pending quotes that have not expired, with the oldest age", () => {
    const quotes = [
      quote({ id: "a", total: "100.10", createdAt: "2026-10-30", expiresAt: null }),
      quote({ id: "b", total: "50.05", createdAt: "2026-10-01", expiresAt: "2026-12-01" }),
      quote({ id: "c", total: "999.00", expiresAt: "2026-10-01" }),
      quote({ id: "d", status: "draft", total: "10.00" }),
    ];
    expect(pendingQuotes(quotes, TODAY)).toEqual({ count: 2, total: "150.15", oldestDays: 34 });
    expect(pendingQuotes([], TODAY)).toEqual({ count: 0, total: "0.00", oldestDays: null });
  });
});

describe("saved demo data upgrade: quote statuses (spec B1)", () => {
  const shift = { days: 0, weeks: 0 };
  const old = (status: string) => {
    const row: Record<string, unknown> = { ...summit.quotes[0]!, status, createdAt: "2026-09-01" };
    delete row.sentAt;
    delete row.expiresAt;
    return row;
  };

  it("renames sent and invoiced, and dates a sent quote from its creation", () => {
    const out = upgradeOverlay(
      {
        schemaVersion: 2,
        shift,
        settings: null,
        records: { quotes: { a: old("sent"), b: old("invoiced"), c: old("draft") } },
      },
      { base: summit },
    );
    expect(out.records.quotes!.a).toMatchObject({ status: "pending", sentAt: "2026-09-01", expiresAt: "2026-10-01" });
    expect(out.records.quotes!.b).toMatchObject({ status: "converted", sentAt: "2026-09-01" });
    expect(out.records.quotes!.c).toMatchObject({ status: "draft", sentAt: null, expiresAt: null });
  });

  it("runs every step from version 1 data", () => {
    const out = upgradeOverlay({ shift, settings: null, records: { quotes: { a: old("sent") } } }, { base: summit });
    expect(out.records.quotes!.a).toMatchObject({ status: "pending", taxOverride: null });
  });
});

describe("saved demo data upgrade: invoices and payments (spec Appendix A)", () => {
  const shift = { days: 0, weeks: 0 };
  const quote = summit.quotes.find((q) => q.invoiceId && q.depositPct !== "0")!;
  const oldInvoice = (status: string) => {
    const row: Record<string, unknown> = {
      ...summit.invoices.find((i) => i.id === quote.invoiceId)!,
      status,
      paid: "0.00",
    };
    for (const key of [
      "createdBy",
      "sentAt",
      "sentBy",
      "voidedAt",
      "voidReason",
      "depositPct",
      "creditForInvoiceId",
      "refundedAt",
    ])
      delete row[key];
    return row;
  };

  it("drops stored status and paid, keeps a void date and takes the deposit from the quote", () => {
    const out = upgradeOverlay(
      {
        schemaVersion: 2,
        shift,
        settings: null,
        records: { invoices: { a: oldInvoice("open"), b: oldInvoice("void") } },
      },
      { base: summit },
    );
    const a = out.records.invoices!.a as Record<string, unknown>;
    expect(a).not.toHaveProperty("status");
    expect(a).not.toHaveProperty("paid");
    expect(a).toMatchObject({ depositPct: quote.depositPct, voidedAt: null, sentAt: a.issuedAt });
    expect(out.records.invoices!.b).toMatchObject({ voidedAt: a.issuedAt });
  });

  it("turns an old payment into a confirmed one that still counts", () => {
    const old = {
      id: "sm-pay-x",
      invoiceId: "i",
      customerId: "c",
      at: "2026-10-02T10:00",
      amount: "10.00",
      method: "cash",
    };
    const out = upgradeOverlay(
      { schemaVersion: 2, shift, settings: null, records: { payments: { x: old } } },
      { base: summit },
    );
    expect(out.records.payments!.x).toMatchObject({
      date: "2026-10-02",
      status: "confirmed",
      files: [],
      amount: "10.00",
    });
  });
});

describe("saved demo data upgrade: purchasing (spec D1 to D3)", () => {
  const shift = { days: 0, weeks: 0 };
  it("gives a received order its receipt, and turns bill payments into supplier payments", () => {
    const po = {
      ...summit.purchaseOrders[0]!,
      id: "po-x",
      number: "PO-9001",
      status: "received",
      receivedAt: "2026-10-02",
    } as Record<string, unknown>;
    delete po.orderedAt;
    delete po.cancelledAt;
    const bill = {
      id: "b-x",
      number: "S-1",
      supplierId: po.supplierId,
      poId: "po-x",
      issuedAt: "2026-10-02",
      dueAt: "2026-11-01",
      total: "10.00",
      paid: "10.00",
    };
    const old = { id: "bp-x", billId: "b-x", supplierId: po.supplierId, at: "2026-10-05", amount: "10.00" };
    const out = upgradeOverlay(
      {
        schemaVersion: 2,
        shift,
        settings: null,
        records: { purchaseOrders: { "po-x": po }, bills: { "b-x": bill }, billPayments: { "bp-x": old } },
      },
      { base: summit },
    );
    expect(out.records.purchaseOrders!["po-x"]).toMatchObject({ status: "ordered", orderedAt: expect.any(String) });
    expect(out.records.receipts!["po-x-gr"]).toMatchObject({ poId: "po-x" });
    expect(out.records.bills!["b-x"]).toMatchObject({ receiptIds: ["po-x-gr"], matchIssues: [] });
    expect(out.records.bills!["b-x"]).not.toHaveProperty("paid");
    expect(out.records.supplierPayments!["bp-x"]).toMatchObject({
      status: "confirmed",
      allocations: [{ billId: "b-x", amount: "10.00" }],
    });
    expect(out.records).not.toHaveProperty("billPayments");
  });
});
