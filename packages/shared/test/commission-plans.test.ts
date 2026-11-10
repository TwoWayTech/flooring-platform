import { describe, expect, it } from "vitest";
import {
  adjustmentProblem,
  commissionCurve,
  commissionLines,
  dec,
  statementChain,
  statementKey,
  type CommissionAssignment,
  type CommissionInputs,
  type CommissionPlan,
  type Invoice,
  type Payment,
} from "../src";

const plan = (patch: Partial<CommissionPlan> = {}): CommissionPlan => ({
  id: "p",
  name: "Test",
  version: 1,
  status: "active",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  basis: "paid_revenue",
  baseRatePct: "5",
  monthlyTarget: "100000",
  tierMode: "marginal",
  tiers: [],
  overridePct: "0",
  draw: { kind: "none", monthlyAmount: "0" },
  clawbackDays: 90,
  ...patch,
});
const assign = (userId: string): CommissionAssignment => ({
  id: `a-${userId}`,
  userId,
  planId: "p",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  monthlyTargetOverride: null,
  acknowledgement: null,
});
const invoice = (patch: Partial<Invoice>): Invoice =>
  ({
    id: "i1",
    salesRepId: "dana",
    voidedAt: null,
    isReturn: false,
    creditForInvoiceId: null,
    issuedAt: "2026-09-01",
    ...patch,
  }) as Invoice;
const payment = (id: string, amount: string, date: string, patch: Partial<Payment> = {}): Payment =>
  ({
    id,
    invoiceId: "i1",
    amount,
    status: "confirmed",
    recordedAt: `${date}T10:00`,
    reviewedAt: null,
    voidedAt: null,
    ...patch,
  }) as Payment;
const inputs = (over: Partial<CommissionInputs>): CommissionInputs => ({
  plans: [plan()],
  assignments: [assign("dana"), assign("luis")],
  invoices: [],
  payments: [],
  adjustments: [],
  managerOf: () => null,
  frozen: new Set(),
  today: "2026-12-31",
  ...over,
});

describe("commission tiers (spec C1, ADR 0025)", () => {
  const tiered = plan({
    baseRatePct: "25",
    monthlyTarget: "20000",
    tiers: [{ fromPctOfTarget: "100", ratePct: "30" }],
  });

  it("marginal tiers apply each rate only inside its band", () => {
    expect(commissionCurve(tiered, dec(20000), dec(22700)).toString()).toBe("5810");
    expect(commissionCurve(tiered, dec(20000), dec(18500)).toString()).toBe("4625");
  });

  it("retroactive tiers re-rate the whole amount once a threshold is reached", () => {
    expect(commissionCurve({ ...tiered, tierMode: "retroactive" }, dec(20000), dec(22700)).toString()).toBe("6810");
    expect(commissionCurve({ ...tiered, tierMode: "retroactive" }, dec(20000), dec(18500)).toString()).toBe("4625");
  });
});

describe("commission on collection (spec C1, ADR 0025)", () => {
  it("worked example 1: margin plan, split, tier crossing and override", () => {
    const tiered = plan({
      basis: "gross_margin",
      baseRatePct: "25",
      monthlyTarget: "20000",
      tiers: [{ fromPctOfTarget: "100", ratePct: "30" }],
      overridePct: "2",
    });
    const inv = invoice({
      subtotal: "40000.00",
      total: "43300.00",
      cost: "26000.00",
      commissionSplit: [
        { userId: "dana", pct: "60" },
        { userId: "luis", pct: "40" },
      ],
    });
    const priorDana = invoice({ id: "i0", subtotal: "18500", total: "18500", cost: "0", salesRepId: "dana" });
    const priorLuis = invoice({ id: "i00", subtotal: "3000", total: "3000", cost: "0", salesRepId: "luis" });
    const lines = commissionLines(
      inputs({
        plans: [tiered],
        invoices: [priorDana, priorLuis, inv],
        managerOf: (u) => (u === "dana" || u === "luis" ? "boss" : null),
        payments: [
          payment("p0", "18500.00", "2026-11-01", { invoiceId: "i0" }),
          payment("p00", "3000.00", "2026-11-01", { invoiceId: "i00" }),
          payment("dep", "21650.00", "2026-11-20"),
        ],
      }),
    ).filter((l) => l.sourceId === "dep");
    const of = (user: string, kind: string) =>
      lines.find(
        (l) =>
          l.userId === user &&
          l.kind === kind &&
          (kind === "earned" || l.subjectUserId === (user === "boss" ? "dana" : user)),
      );
    expect(of("dana", "earned")).toMatchObject({ base: "4200.00", commission: "1185.00" });
    expect(of("luis", "earned")).toMatchObject({ base: "2800.00", commission: "700.00" });
    expect(
      lines
        .filter((l) => l.kind === "override")
        .map((l) => l.commission)
        .sort(),
    ).toEqual(["56.00", "84.00"]);
  });

  const inv = invoice({ subtotal: "7250.00", total: "7893.44", cost: "0" });
  const pays = [payment("a", "2000.00", "2026-09-20"), payment("b", "5893.44", "2026-10-20")];

  it("worked example 2: part payments add up exactly to the rate on the subtotal", () => {
    const lines = commissionLines(inputs({ invoices: [inv], payments: pays }));
    expect(lines.map((l) => l.commission)).toEqual(["91.85", "270.65"]);
    expect(lines.map((l) => l.windowEndsOn)).toEqual(["2026-12-19", "2027-01-18"]);
  });

  it("worked example 2: a credit note reverses only inside the window", () => {
    const credit = invoice({
      id: "c1",
      creditForInvoiceId: "i1",
      issuedAt: "2027-01-05",
      subtotal: "1450.00",
      total: "1578.69",
      cost: "0",
    });
    const lines = commissionLines(inputs({ invoices: [inv, credit], payments: pays, today: "2027-01-31" }));
    expect(lines.filter((l) => l.kind === "reversal").map((l) => l.commission)).toEqual(["-72.50"]);
    const late = invoice({
      id: "c2",
      creditForInvoiceId: "i1",
      issuedAt: "2027-02-01",
      subtotal: "2000.00",
      total: "2177.50",
      cost: "0",
    });
    const none = commissionLines(inputs({ invoices: [inv, late], payments: pays, today: "2027-02-28" }));
    expect(none.filter((l) => l.kind === "reversal")).toEqual([]);
  });

  it("a second credit note takes only its own amount", () => {
    const first = invoice({
      id: "c1",
      creditForInvoiceId: "i1",
      issuedAt: "2027-01-05",
      subtotal: "1450.00",
      total: "1578.69",
      cost: "0",
    });
    const second = invoice({
      id: "c2",
      creditForInvoiceId: "i1",
      issuedAt: "2027-01-10",
      subtotal: "1000.00",
      total: "1088.75",
      cost: "0",
    });
    const lines = commissionLines(inputs({ invoices: [inv, first, second], payments: pays, today: "2027-01-31" }));
    expect(lines.filter((l) => l.kind === "reversal").map((l) => l.commission)).toEqual(["-72.50", "-50.00"]);
  });

  it("a credit note on a split sale reverses each rep by their share", () => {
    const sale = invoice({
      subtotal: "8000.00",
      total: "8000.00",
      cost: "0",
      commissionSplit: [
        { userId: "dana", pct: "60" },
        { userId: "luis", pct: "40" },
      ],
    });
    const credit = invoice({
      id: "c1",
      creditForInvoiceId: "i1",
      issuedAt: "2026-11-10",
      subtotal: "1000.00",
      total: "1000.00",
      cost: "0",
    });
    const lines = commissionLines(
      inputs({ invoices: [sale, credit], payments: [payment("a", "8000.00", "2026-11-01")] }),
    );
    expect(lines.filter((l) => l.kind === "reversal").map((l) => [l.userId, l.base, l.commission])).toEqual([
      ["dana", "-600.00", "-30.00"],
      ["luis", "-400.00", "-20.00"],
    ]);
  });

  it("a void before approval simply does not earn; after approval it reverses, inside or for review outside the window", () => {
    const voided = (at: string) => payment("a", "2000.00", "2026-09-20", { status: "voided", voidedAt: at });
    expect(commissionLines(inputs({ invoices: [inv], payments: [voided("2026-09-25")] }))).toEqual([]);
    const frozen = new Set([statementKey("dana", "2026-09")]);
    const inside = commissionLines(inputs({ invoices: [inv], payments: [voided("2026-10-05")], frozen }));
    expect(inside.map((l) => [l.kind, l.month, l.commission, l.reversalState])).toEqual([
      ["earned", "2026-09", "91.85", null],
      ["reversal", "2026-10", "-91.85", "applied"],
    ]);
    const outside = commissionLines(
      inputs({ invoices: [inv], payments: [voided("2027-01-10")], frozen, today: "2027-02-01" }),
    );
    expect(outside.at(-1)).toMatchObject({ reversalState: "needs_review" });
  });

  it("a replacement payment after a void earns in full", () => {
    const voided = payment("a", "2000.00", "2026-09-20", { status: "voided", voidedAt: "2026-10-05" });
    const frozen = new Set([statementKey("dana", "2026-09")]);
    const lines = commissionLines(
      inputs({
        invoices: [inv],
        payments: [voided, payment("c", "2000.00", "2026-10-06"), payment("b", "5893.44", "2026-10-20")],
        frozen,
      }),
    );
    expect(lines.reduce((total, l) => total.plus(l.commission), dec(0)).toFixed(2)).toBe("362.50");
  });

  it("does not pay commission on an overpayment", () => {
    const lines = commissionLines(inputs({ invoices: [inv], payments: [payment("over", "9000.00", "2026-09-20")] }));
    expect(lines[0]!.base).toBe("7250.00");
  });

  it("the margin basis on a part payment earns the same share of the margin", () => {
    const m = plan({ basis: "gross_margin", baseRatePct: "10" });
    const half = commissionLines(
      inputs({
        plans: [m],
        invoices: [invoice({ subtotal: "1000.00", total: "1000.00", cost: "600.00" })],
        payments: [payment("h", "500.00", "2026-09-20")],
      }),
    );
    expect(half[0]).toMatchObject({ base: "200.00", commission: "20.00" });
  });

  it("ignores people with no plan on the day", () => {
    expect(commissionLines(inputs({ assignments: [], invoices: [inv], payments: pays }))).toEqual([]);
  });
});

describe("statements and draws (spec C1, ADR 0025)", () => {
  const line = (month: string, commission: string, kind: "earned" | "reversal" = "earned") =>
    ({ userId: "dana", month, kind, commission, reversalState: kind === "reversal" ? "applied" : null }) as never;
  const adj = (month: string, amount: string) => ({ userId: "dana", month, amount }) as never;
  const drawPlan = plan({ draw: { kind: "recoverable", monthlyAmount: "1500" } });

  it("carries a recoverable draw forward and never goes negative", () => {
    const chain = statementChain(
      "dana",
      ["2026-11", "2026-12"],
      [line("2026-11", "500"), line("2026-12", "4000")],
      [],
      () => drawPlan,
    );
    expect(chain[0]).toMatchObject({ payable: "1500.00", carryOut: "1000.00" });
    expect(chain[1]).toMatchObject({ carryIn: "1000.00", payable: "3000.00", carryOut: "0.00" });
  });

  it("a negative month pays nothing and is recovered from later commission", () => {
    const chain = statementChain(
      "dana",
      ["2026-11", "2026-12"],
      [line("2026-11", "-285", "reversal"), line("2026-12", "400")],
      [],
      () => plan(),
    );
    expect(chain[0]).toMatchObject({ payable: "0.00", carryOut: "285.00" });
    expect(chain[1]).toMatchObject({ payable: "115.00", carryOut: "0.00" });
  });

  it("adds adjustments, and a deduction must name its invoice", () => {
    const chain = statementChain("dana", ["2026-11"], [line("2026-11", "100")], [adj("2026-11", "50")], () => plan());
    expect(chain[0]!.net).toBe("150.00");
    expect(adjustmentProblem("-20", "Return", null)).toMatch(/invoice/);
    expect(adjustmentProblem("20", "ab", null)).toMatch(/reason/);
    expect(adjustmentProblem("20", "Spiff for October", null)).toBeNull();
  });
});
