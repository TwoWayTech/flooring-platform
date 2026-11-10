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
