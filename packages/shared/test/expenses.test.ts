import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  businessReport,
  dec,
  DEFAULT_SHARED_COSTS,
  dueRecurringDrafts,
  expenseJournal,
  expenseProblem,
  fixedPctProblem,
  fromCents,
  moneyString,
  needsExpenseApproval,
  shareByWeight,
  sum,
  toCents,
  weightsFor,
  type BusinessData,
  type CompanyFixtures,
  type Expense,
  type Location,
  type RecurringExpense,
} from "../src";

const load = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8"),
  ) as CompanyFixtures;
const summit = load("summit");
const keystone = load("keystone");

const dataOf = (f: CompanyFixtures, patch: Partial<BusinessData> = {}): BusinessData => ({
  invoices: f.invoices,
  payments: f.payments,
  adjustments: f.invoiceAdjustments,
  refunds: f.refunds,
  expenses: f.expenses,
  bills: f.bills,
  supplierPayments: f.supplierPayments,
  receipts: f.receipts,
  purchaseOrders: f.purchaseOrders,
  suppliers: f.suppliers,
  users: f.users,
  employees: f.employees,
  locations: f.locations,
  productCategories: f.products,
  products: f.products,
  rolls: f.rolls,
  stockMovements: f.stockMovements,
  payPeriods: f.payPeriods,
  settings: f.settings,
  today: f.anchorDate,
  ...patch,
});
const everything = {
  locationIds: [],
  productCategory: null,
  expenseCategory: null,
  salesRepId: null,
  supplierId: null,
};
const showAll = { margin: true, payroll: true, people: true, stock: true };

const expense = (patch: Partial<Expense> = {}): Expense =>
  ({
    id: "e",
    number: "EXP-1",
    date: "2026-10-05",
    supplierId: "s",
    category: "rent",
    locationId: "loc",
    amount: "100.00",
    tax: "8.00",
    status: "confirmed",
    settlement: "paid",
    files: [],
    ...patch,
  }) as Expense;
const loc = (id: string, floorAreaSqFt = "0"): Location =>
  ({ id, name: id, kind: "warehouse", floorAreaSqFt }) as Location;

describe("expenses (spec F1, ADR 0023)", () => {
  it("needs a vendor, an amount and a receipt to leave draft", () => {
    expect(expenseProblem(expense(), 0)).toMatch(/receipt/);
    expect(expenseProblem(expense({ supplierId: null }), 1)).toMatch(/vendor/);
    expect(expenseProblem(expense({ amount: "0" }), 1)).toMatch(/amount/);
    expect(expenseProblem(expense(), 1)).toBeNull();
  });

  it("waits for approval only above the threshold, counting tax", () => {
    const on = { approvalRequired: true, approvalThreshold: "105.00" };
    expect(needsExpenseApproval(on, expense())).toBe(true);
    expect(needsExpenseApproval(on, expense({ tax: "0" }))).toBe(false);
    expect(needsExpenseApproval({ approvalRequired: false, approvalThreshold: "1" }, expense())).toBe(false);
  });

  const template = (patch: Partial<RecurringExpense> = {}): RecurringExpense =>
    ({
      id: "t",
      active: true,
      frequency: "monthly",
      dayOfMonth: 31,
      startsOn: "2026-01-31",
      endsOn: null,
      ...patch,
    }) as RecurringExpense;

  it("makes one draft per period, clamped to the month's last day, and is safe to repeat", () => {
    const due = dueRecurringDrafts([template()], [], "2026-03-15");
    expect(due.map((d) => d.date)).toEqual(["2026-01-31", "2026-02-28"]);
    const again = dueRecurringDrafts(
      [template()],
      [
        { recurringId: "t", period: "2026-01" },
        { recurringId: "t", period: "2026-02" },
      ],
      "2026-03-15",
    );
    expect(again).toEqual([]);
  });

  it("catches up at most twelve periods, and stops at the end date", () => {
    expect(dueRecurringDrafts([template({ startsOn: "2024-01-15", dayOfMonth: 15 })], [], "2026-03-20")).toHaveLength(
      12,
    );
    expect(dueRecurringDrafts([template({ endsOn: "2026-02-01" })], [], "2026-06-01")).toHaveLength(1);
    expect(dueRecurringDrafts([template({ active: false })], [], "2026-06-01")).toEqual([]);
  });

  it("debits equal credits in every state, and only confirmed or voided expenses post", () => {
    const balanced = (e: Expense) => {
      const lines = expenseJournal(e);
      expect(sum(lines.map((l) => l.debit)).toFixed(2)).toBe(sum(lines.map((l) => l.credit)).toFixed(2));
      return lines;
    };
    expect(balanced(expense({ status: "draft" }))).toEqual([]);
    expect(balanced(expense({ status: "pending" }))).toEqual([]);
    expect(balanced(expense({ status: "confirmed" }))[1]!.account).toBe("Cash or Bank");
    expect(balanced(expense({ settlement: "on_account" }))[1]!.account).toBe("Accounts Payable");
    expect(balanced(expense({ status: "voided" }))).toHaveLength(4);
    expect(balanced(expense({ category: "sales_tax_payment" }))[0]!.account).toBe("Sales Tax Payable");
  });
});

describe("shared costs (spec F1, ADR 0023)", () => {
  it("splits by largest remainder and adds up exactly", () => {
    const shares = shareByWeight(1000n, [
      { id: "a", weight: 1n },
      { id: "b", weight: 1n },
      { id: "c", weight: 1n },
    ]);
    expect([...shares.values()]).toEqual([334n, 333n, 333n]);
    expect([...shares.values()].reduce((s, v) => s + v, 0n)).toBe(1000n);
  });

  it("never gives a cent to a location with no weight", () => {
    const shares = shareByWeight(101n, [
      { id: "a", weight: 1n },
      { id: "b", weight: 0n },
      { id: "c", weight: 1n },
    ]);
    expect(shares.get("b")).toBe(0n);
    expect((shares.get("a") ?? 0n) + (shares.get("c") ?? 0n)).toBe(101n);
  });

  it("falls back to floor area, then equal, when the chosen rule has nothing to go on", () => {
    const settings = { rule: "revenue" as const, fixedPct: {} };
    expect(weightsFor([loc("a", "100"), loc("b", "300")], settings, new Map()).rule).toBe("floor_area");
    expect(weightsFor([loc("a"), loc("b")], settings, new Map()).rule).toBe("equal");
    expect(weightsFor([loc("a")], settings, new Map([["a", 500n]])).rule).toBe("revenue");
  });

  it("splits by revenue share when a company has no settings yet (ADR 0023)", () => {
    expect(DEFAULT_SHARED_COSTS).toEqual({ rule: "revenue", fixedPct: {} });
    expect(weightsFor([loc("a"), loc("b")], DEFAULT_SHARED_COSTS, new Map([["a", 300n]])).rule).toBe("revenue");
  });

  it("refuses fixed percentages that do not total 100", () => {
    expect(fixedPctProblem({ rule: "fixed", fixedPct: { a: "60", b: "30" } }, [loc("a"), loc("b")])).toMatch(/90/);
    expect(fixedPctProblem({ rule: "fixed", fixedPct: { a: "60", b: "40" } }, [loc("a"), loc("b")])).toBeNull();
  });

  it("round-trips cents without losing anything", () => {
    expect(moneyString(fromCents(toCents("1234.56")))).toBe("1234.56");
  });

  it("holds for random amounts and weights", () => {
    let seed = 7;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 300; i += 1) {
      const total = BigInt(next(10_000_000));
      const weights = Array.from({ length: 1 + next(6) }, (_, k) => ({ id: `l${k}`, weight: BigInt(next(1000)) }));
      const shares = shareByWeight(total, weights);
      const W = weights.reduce((s, w) => s + w.weight, 0n);
      expect([...shares.values()].reduce((s, v) => s + v, 0n)).toBe(W === 0n ? 0n : total);
      for (const w of weights) if (w.weight === 0n) expect(shares.get(w.id)).toBe(0n);
    }
  });
});

describe.each([
  ["summit", summit],
  ["keystone", keystone],
] as const)("%s business report (spec F2, ADR 0023)", (_, f) => {
  const period = { from: "2026-01-01", to: f.anchorDate };
  const report = businessReport(dataOf(f), { ...period, ...everything }, showAll);
  const section = (key: string) => report.sections.find((s) => s.key === key)!;
  const summaryValue = (id: string) => section("summary").rows.find((r) => r.id === id)!.values.now!;

  it("has every section", () => {
    expect(report.sections.map((s) => s.key)).toEqual([
      "summary",
      "locations",
      "revenue_category",
      "revenue_rep",
      "expense_category",
      "expense_vendor",
      "expense_location",
      "cash",
      "purchases",
      "taxes",
      "people",
      "stock",
    ]);
  });

  it("location profits add up exactly to company profit", () => {
    expect(section("locations").total!.values.net).toBe(summaryValue("net"));
    expect(section("locations").total!.values.revenue).toBe(summaryValue("revenue"));
  });

  it("counts a credit note, which has no lines, the same in every section", () => {
    const base = f.invoices.find((i) => !i.voidedAt && !i.isReturn && i.issuedAt >= period.from)!;
    const credit = {
      ...base,
      id: "credit-note",
      isReturn: true,
      subtotal: "100.00",
      cost: "40.00",
      tax: "0.00",
      total: "100.00",
      lines: [],
    };
    const data = dataOf(f);
    const after = businessReport(
      { ...data, invoices: [...data.invoices, credit] },
      { ...period, ...everything },
      showAll,
    );
    const part = (key: string) => after.sections.find((s) => s.key === key)!;
    const revenue = part("summary").rows.find((r) => r.id === "revenue")!.values.now!;
    expect(Number(revenue)).toBeCloseTo(Number(summaryValue("revenue")) - 100, 2);
    expect(part("locations").total!.values.revenue).toBe(revenue);
    const row = part("revenue_category").rows.find((r) => r.id === "credit_note")!;
    expect(row.label).toBe("Credit notes");
    expect(Number(row.values.revenue)).toBe(-100);
    expect(Number(row.values.margin)).toBe(-60);
  });

  it("holds for other periods too", () => {
    for (const [from, to] of [
      ["2026-03-01", "2026-03-31"],
      ["2025-12-15", "2026-02-10"],
    ] as const) {
      const other = businessReport(dataOf(f), { from, to, ...everything }, showAll);
      const net = other.sections.find((s) => s.key === "summary")!.rows.find((r) => r.id === "net")!.values.now;
      expect(other.sections.find((s) => s.key === "locations")!.total!.values.net).toBe(net);
    }
  });

  it("revenue by category and by salesperson both equal revenue", () => {
    expect(section("revenue_category").total!.values.revenue).toBe(summaryValue("revenue"));
    expect(section("revenue_rep").total!.values.revenue).toBe(summaryValue("revenue"));
  });

  it("expenses add up the same by category, vendor and location", () => {
    const totals = ["expense_category", "expense_vendor", "expense_location"].map(
      (k) => section(k).total!.values.amount,
    );
    expect(totals[0]).toBeDefined();
    expect(new Set(totals).size).toBe(1);
  });

  it("compares with the period before it", () => {
    expect(report.previous.to).toBe("2025-12-31");
    expect(section("summary").columns.map((c) => c.id)).toEqual(["now", "before", "change"]);
  });

  it("hides what a person may not see instead of showing zero", () => {
    const limited = businessReport(
      dataOf(f),
      { ...period, ...everything },
      { margin: false, payroll: false, people: false, stock: false },
    );
    const keys = limited.sections.map((s) => s.key);
    expect(keys).not.toContain("locations");
    expect(keys).not.toContain("people");
    expect(keys).not.toContain("stock");
    // Purchases are at order cost, which needs the product-cost key (ADR 0055 S5).
    expect(keys).not.toContain("purchases");
    expect(limited.sections[0]!.rows.map((r) => r.id)).not.toContain("gross");
  });

  it("filtering to one salesperson stops the summary at gross profit", () => {
    const rep = f.invoices.find((i) => !i.isReturn)!.salesRepId;
    const filtered = businessReport(dataOf(f), { ...period, ...everything, salesRepId: rep }, showAll);
    const ids = filtered.sections[0]!.rows.map((r) => r.id);
    expect(ids).toContain("gross");
    expect(ids).not.toContain("net");
    expect(dec(filtered.sections[0]!.rows[0]!.values.now!).lt(summaryValue("revenue"))).toBe(true);
  });

  it("a sales tax payment is not a cost", () => {
    const keys = section("expense_category").rows.map((r) => r.id);
    expect(keys).not.toContain("sales_tax_payment");
    expect(section("taxes").rows.find((r) => r.id === "paid")!.values.amount).not.toBe("0.00");
  });
});
