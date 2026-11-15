import { describe, expect, it } from "vitest";
import {
  adjustmentProblem,
  commissionCurve,
  commissionLines,
  commissionShortfalls,
  dec,
  lineConfirmedAt,
  managerOn,
  managerRowOn,
  managerSelfSetOn,
  statementChain,
  statementKey,
  type CommissionAssignment,
  type CommissionInputs,
  type CommissionPlan,
  type Invoice,
  type ManagerHistoryRow,
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

  it("bounds an adjustment to 1,000,000.00 either way and twelve digits", () => {
    expect(adjustmentProblem("1000000.00", "Year-end spiff", null)).toBeNull();
    expect(adjustmentProblem("1000000.01", "Year-end spiff", null)).toMatch(/at most 1,000,000.00/);
    expect(adjustmentProblem("-1000000.01", "Returned job", "i1")).toMatch(/at most 1,000,000.00/);
    expect(adjustmentProblem("1".repeat(13), "Year-end spiff", null)).toMatch(/Enter an amount/);
  });

  it("finds pay lines whose gross pay is below the commission they pay", () => {
    expect(
      commissionShortfalls([
        { employeeId: "e1", grossPay: "0.00", commissionPay: "90.00" },
        { employeeId: "e2", grossPay: "90.00", commissionPay: "90.00" },
        { employeeId: "e3", grossPay: "1000.00", commissionPay: "0.00" },
      ]),
    ).toEqual(["e1"]);
  });
});

describe("dated managers for overrides (owner decision 2026-11-15; ADR 0048)", () => {
  const row = (
    employeeId: string,
    managerId: string | null,
    effectiveFrom: string | null,
    recordedOrder: string,
  ): ManagerHistoryRow => ({ employeeId, managerId, effectiveFrom, recordedOrder });

  it("reads the latest row on or before the day, a since-records-began row first", () => {
    const history = [
      row("e-dana", "e-new", "2026-11-15", "02"),
      row("e-dana", "e-boss", null, "01"),
      row("e-luis", "e-other", null, "03"),
    ];
    expect(managerOn(history, "e-dana", "2026-01-01", "e-today")).toBe("e-boss");
    expect(managerOn(history, "e-dana", "2026-11-14", "e-today")).toBe("e-boss");
    expect(managerOn(history, "e-dana", "2026-11-15", "e-today")).toBe("e-new");
    expect(managerOn(history, "e-dana", "2027-03-01", "e-today")).toBe("e-new");
  });

  it("breaks a same-day tie by the later recorded row, and a row can clear the manager", () => {
    const history = [
      row("e-dana", "e-boss", null, "01"),
      row("e-dana", null, "2026-11-15", "03"),
      row("e-dana", "e-new", "2026-11-15", "02"),
    ];
    expect(managerOn(history, "e-dana", "2026-11-15", "e-today")).toBeNull();
    expect(managerOn(history, "e-dana", "2026-11-14", "e-today")).toBe("e-boss");
  });

  it("falls back to today's manager with no rows, and reads the first row before it begins", () => {
    expect(managerOn([], "e-dana", "2026-11-15", "e-today")).toBe("e-today");
    expect(managerOn([row("e-luis", "e-x", null, "01")], "e-dana", "2026-11-15", null)).toBeNull();
    const added = [row("e-dana", "e-boss", "2026-11-10", "01"), row("e-dana", "e-new", "2026-11-20", "02")];
    expect(managerOn(added, "e-dana", "2026-11-01", "e-today")).toBe("e-boss");
  });

  // Dana reports to Boss until Newboss takes over on 2026-11-15 (a reorg mid-month).
  const reorg = [row("e-dana", "e-boss", null, "01"), row("e-dana", "e-new", "2026-11-15", "02")];
  const employeeOf: Readonly<Record<string, string>> = { dana: "e-dana" };
  const userOfEmployee: Readonly<Record<string, string>> = { "e-boss": "boss", "e-new": "newboss" };
  /** User, then employee, then the manager on the moment's day, then that manager's user, as the API does. */
  const managerOf = (userId: string, at: string) => {
    const manager = managerOn(reorg, employeeOf[userId] ?? "", at.slice(0, 10), null);
    return manager ? (userOfEmployee[manager] ?? null) : null;
  };

  it("pays a mid-month reorg's override to the old manager before the change day and the new one from it", () => {
    const pays = [
      payment("p1", "1000.00", "2026-11-14"),
      payment("p2", "1000.00", "2026-11-15"),
      payment("p3", "1000.00", "2026-11-28"),
    ];
    const lines = commissionLines(
      inputs({
        plans: [plan({ overridePct: "2" })],
        invoices: [invoice({ subtotal: "3000.00", total: "3000.00", cost: "0" })],
        payments: pays,
        managerOf,
      }),
    );
    const overrides = lines.filter((l) => l.kind === "override");
    expect(overrides.map((l) => [l.sourceId, l.userId, l.subjectUserId, l.commission])).toEqual([
      ["p1", "boss", "dana", "20.00"],
      ["p2", "newboss", "dana", "20.00"],
      ["p3", "newboss", "dana", "20.00"],
    ]);
  });

  it("reverses an override against the manager who earned it, not the manager on the day of the void", () => {
    const voided = payment("p1", "1000.00", "2026-11-10", { status: "voided", voidedAt: "2026-12-05T09:00" });
    const lines = commissionLines(
      inputs({
        plans: [plan({ overridePct: "2" })],
        invoices: [invoice({ subtotal: "1000.00", total: "1000.00", cost: "0" })],
        payments: [voided],
        managerOf,
        frozen: new Set([statementKey("dana", "2026-11")]),
      }),
    );
    const reversal = lines.find((l) => l.kind === "reversal" && l.subjectUserId === "dana");
    expect(reversal).toMatchObject({ userId: "boss", month: "2026-12", commission: "-20.00" });
  });

  it("asks for the manager at the moment a payment was confirmed, its review over its recording, and finds that moment for a line", () => {
    const asked: string[] = [];
    const reviewed = payment("p1", "1000.00", "2026-11-14", { reviewedAt: "2026-11-15T01:30" });
    const credit = {
      id: "c1",
      invoiceId: "i1",
      customerId: "cu",
      kind: "credit_applied" as const,
      amount: "100.00",
      reason: "",
      byName: "",
      at: "2026-11-20T23:10",
    };
    const all = inputs({
      plans: [plan({ overridePct: "2" })],
      invoices: [invoice({ subtotal: "2000.00", total: "2000.00", cost: "0" })],
      payments: [reviewed],
      adjustments: [credit],
      managerOf: (_userId, at) => {
        asked.push(at);
        return "boss";
      },
    });
    const overrides = commissionLines(all).filter((l) => l.kind === "override");
    expect(asked).toEqual(["2026-11-15T01:30", "2026-11-20T23:10"]);
    expect(overrides.map((l) => lineConfirmedAt(all, l))).toEqual(["2026-11-15T01:30", "2026-11-20T23:10"]);
    expect(lineConfirmedAt(all, { sourceId: "gone", confirmedOn: "2026-11-02" })).toBe("2026-11-02");
  });
});

describe("self-made managers judged on the line's day (ADR 0048; first review of PR #32)", () => {
  const row = (
    managerId: string | null,
    effectiveFrom: string | null,
    recordedOrder: string,
    setBy: string | null,
  ): ManagerHistoryRow => ({ employeeId: "e-rex", managerId, effectiveFrom, recordedOrder, setBy });

  it("reads the row in force on the day, or none without rows", () => {
    const history = [row("e-sid", null, "01", "sid"), row("e-ola", "2026-11-15", "02", "owner")];
    expect(managerRowOn(history, "e-rex", "2026-11-14")).toMatchObject({ managerId: "e-sid", setBy: "sid" });
    expect(managerRowOn(history, "e-rex", "2026-11-15")).toMatchObject({ managerId: "e-ola" });
    expect(managerRowOn(history, "e-other", "2026-11-15")).toBeNull();
  });

  it("keeps the days a person set themselves self-made when the manager later moves to someone else", () => {
    const history = [row("e-sid", "2026-01-05", "01", "sid"), row("e-ola", "2026-11-15", "02", "owner")];
    expect(managerSelfSetOn(history, "e-rex", "2026-10-01", "sid")).toBe(true);
    expect(managerSelfSetOn(history, "e-rex", "2026-11-15", "sid")).toBe(false);
    expect(managerSelfSetOn(history, "e-rex", "2026-10-01", "owner")).toBe(false);
  });

  it("clears the earlier days once someone else sets that same manager again, but not by a row overtaken the same day", () => {
    const overtaken = [
      row("e-sid", "2026-01-05", "01", "sid"),
      row("e-sid", "2026-11-15", "02", "owner"),
      row("e-ola", "2026-11-15", "03", "owner"),
    ];
    expect(managerSelfSetOn(overtaken, "e-rex", "2026-10-01", "sid")).toBe(true);
    const setAgain = [...overtaken, row("e-sid", "2026-11-20", "04", "owner")];
    expect(managerSelfSetOn(setAgain, "e-rex", "2026-10-01", "sid")).toBe(false);
    const bySelf = [...overtaken, row("e-sid", "2026-11-20", "04", "sid")];
    expect(managerSelfSetOn(bySelf, "e-rex", "2026-10-01", "sid")).toBe(true);
  });

  it("treats a row with nobody known as set by someone else", () => {
    expect(managerSelfSetOn([row("e-sid", null, "01", null)], "e-rex", "2026-10-01", "sid")).toBe(false);
    expect(managerSelfSetOn([], "e-rex", "2026-10-01", "sid")).toBe(false);
  });
});
