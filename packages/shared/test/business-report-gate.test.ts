import { describe, expect, it } from "vitest";
import {
  addDays,
  businessReport,
  businessWindow,
  computeTotals,
  dec,
  lineAmount,
  roundMoney,
  sum,
  type BusinessAdjustment,
  type BusinessData,
  type BusinessEmployee,
  type BusinessExpense,
  type BusinessFilters,
  type BusinessInvoice,
  type BusinessLocation,
  type BusinessPayPeriod,
  type BusinessVisibility,
  type DocLine,
  type ExpenseCategory,
  type SalesLine,
  type SharedCostSettings,
} from "../src";
import { businessDataOf, loadFixtures, NO_FILTERS, rowsOf, sectionOf, summaryValue } from "./report-fixtures";

const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

/** Lines no report may read: any invoice outside the window carries these, so reading one changes the answer. */
const BOGUS_LINES: readonly SalesLine[] = [
  { productId: undefined, category: "material", quantity: "1000", unitPrice: "99999.99", unitCost: "1.00" },
];

/**
 * The documents the API reads for a Business report (ADR 0055; plan B.4), cut in memory from the
 * whole record: invoice heads to `headsTo` plus the invoices write-offs in the window name, lines only
 * on live heads dated in [datedFrom, datedTo], payments, adjustments, supplier payments and sales tax
 * payments to `historyTo`, other dated documents in [datedFrom, datedTo], receipts in the period and
 * only their orders, pay only with pay sight, rep names only for the window's heads, stock only with
 * `stock`, and stock movements as one total per product and location.
 */
function windowed(
  data: BusinessData,
  filters: BusinessFilters,
  show: BusinessVisibility,
  headsTo = businessWindow(filters, data.today).headsTo,
): BusinessData {
  const w = businessWindow(filters, data.today);
  const dated = (day: string) => inRange(day, w.datedFrom, w.datedTo);
  const writtenOff = new Set(
    data.adjustments.filter((a) => a.kind === "write_off" && dated(a.at.slice(0, 10))).map((a) => a.invoiceId),
  );
  const heads = data.invoices.filter((i) => i.issuedAt <= headsTo || writtenOff.has(i.id));
  const invoices = heads.map((i) => (!i.voidedAt && dated(i.issuedAt) ? i : { ...i, lines: BOGUS_LINES }));
  const receipts = show.stock
    ? data.receipts.filter((r) => inRange(r.receivedAt.slice(0, 10), w.receiptsFrom, w.receiptsTo))
    : [];
  const orderIds = new Set(receipts.map((r) => r.poId));
  const payPeriods = show.payroll
    ? data.payPeriods.filter((p) => (p.status === "approved" || p.status === "exported") && dated(p.end))
    : [];
  const paid = new Set(payPeriods.flatMap((p) => p.lines.map((l) => l.employeeId)));
  const reps = new Set(heads.filter((i) => dated(i.issuedAt)).map((i) => i.salesRepId));
  const totals = new Map<string, { productId: string; locationId: string; quantity: string }>();
  for (const m of data.stockMovements) {
    const key = `${m.productId}|${m.locationId}`;
    const before = totals.get(key)?.quantity ?? "0";
    totals.set(key, {
      productId: m.productId,
      locationId: m.locationId,
      quantity: dec(before).plus(m.quantity).toString(),
    });
  }
  return {
    ...data,
    invoices,
    payments: data.payments.filter((p) => p.date <= w.historyTo),
    adjustments: data.adjustments.filter((a) => a.at.slice(0, 10) <= w.historyTo),
    refunds: data.refunds.filter((r) => dated(r.date)),
    expenses: data.expenses.filter(
      (e) =>
        (dated(e.date) || (e.category === "sales_tax_payment" && e.date <= w.historyTo)) &&
        (show.payroll || e.category !== "payroll"),
    ),
    supplierPayments: data.supplierPayments.filter((p) => p.date <= w.historyTo),
    receipts,
    purchaseOrders: data.purchaseOrders.filter((o) => orderIds.has(o.id)),
    users: data.users.filter((u) => reps.has(u.id)),
    employees: data.employees.filter((e) => paid.has(e.id)),
    payPeriods,
    products: show.stock ? data.products : [],
    rolls: show.stock ? data.rolls : [],
    stockMovements: show.stock ? [...totals.values()] : [],
  };
}

/** Edge documents the seeded companies lack: a void, a line-less credit note and write-offs, one on a later invoice. */
function withEdges(data: BusinessData, filters: BusinessFilters): BusinessData {
  const live = data.invoices.filter((i) => !i.voidedAt && !i.isReturn && i.lines.length > 0);
  const inPeriod = live.find((i) => inRange(i.issuedAt, filters.from, filters.to)) ?? live[0]!;
  const oldest = [...live].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0]!;
  const later: BusinessInvoice = { ...inPeriod, id: "edge-later", number: "INV-LATER", issuedAt: "2027-06-01" };
  const voided: BusinessInvoice = { ...inPeriod, id: "edge-void", number: "INV-VOID", voidedAt: `${filters.to}T09:00` };
  const credit: BusinessInvoice = {
    ...inPeriod,
    id: "edge-credit",
    number: "CN-EDGE",
    isReturn: true,
    lines: [],
    subtotal: "100.00",
    cost: "40.00",
    tax: "0.00",
    total: "100.00",
  };
  const writeOff = (invoiceId: string, day: string): BusinessAdjustment => ({
    invoiceId,
    kind: "write_off",
    amount: "25.00",
    at: `${day}T12:00`,
  });
  return {
    ...data,
    invoices: [...data.invoices, later, voided, credit],
    adjustments: [
      ...data.adjustments,
      writeOff(oldest.id, filters.to),
      writeOff(later.id, filters.from),
      writeOff(inPeriod.id, businessWindow(filters, data.today).previous.from),
    ],
  };
}

describe.each(["summit", "keystone"] as const)(
  "%s: windowed reads give the whole record's answer (S-WIN-1)",
  (name) => {
    const f = loadFixtures(name);
    const whole = businessDataOf(f);
    const periods: [string, string][] = [
      ["2026-03-01", "2026-03-31"],
      ["2025-12-15", "2026-02-10"],
      ["2026-01-01", f.anchorDate],
      [addDays(f.anchorDate, -365), f.anchorDate],
    ];
    const shows: BusinessVisibility[] = [
      { margin: true, payroll: false, people: true, stock: true },
      { margin: true, payroll: true, people: true, stock: true },
    ];

    it.each(periods)("%s to %s", (from, to) => {
      const filters = { from, to, ...NO_FILTERS };
      const data = withEdges(whole, filters);
      for (const show of shows) {
        expect(businessReport(windowed(data, filters, show), filters, show)).toEqual(
          businessReport(data, filters, show),
        );
      }
    });
  },
);

describe("invoice heads are read to the end of the period's month (S-WIN-1, headsTo)", () => {
  const f = loadFixtures("summit");
  const filters = { from: "2026-10-01", to: "2026-10-15", ...NO_FILTERS };
  const show = { margin: true, payroll: true, people: true, stock: true };
  const data = withEdges(businessDataOf(f), filters);

  it("matches the whole record, while heads cut at the period's end would not", () => {
    // Company-wide October costs are shared by October's whole revenue (rule 6), and Summit has
    // invoices after the 15th, so cutting heads at `to` would move shares between locations.
    expect(data.expenses.some((e) => !e.locationId && e.date.startsWith("2026-10") && e.status === "confirmed")).toBe(
      true,
    );
    expect(data.invoices.some((i) => i.issuedAt > filters.to && i.issuedAt.startsWith("2026-10"))).toBe(true);
    const expected = businessReport(data, filters, show);
    expect(businessReport(windowed(data, filters, show), filters, show)).toEqual(expected);
    const cut = businessReport(windowed(data, filters, show, filters.to), filters, show);
    expect(sectionOf(cut, "locations").rows.map((r) => r.values.shared)).not.toEqual(
      sectionOf(expected, "locations").rows.map((r) => r.values.shared),
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// The week-18 gate (docs/real-build-plan.md, module 15): location profits add up to company profit.
// ---------------------------------------------------------------------------------------------------

/** A seeded PRNG (the LCG of expenses.test.ts), so a failing run replays from its seed. */
function prng(seed: number) {
  let state = seed;
  const int = (n: number) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % n;
  return {
    int,
    pick: <T>(items: readonly T[]): T => items[int(items.length)]!,
    chance: (pct: number) => int(100) < pct,
    money: (max: number) => `${int(max)}.${String(int(100)).padStart(2, "0")}`,
  };
}
type Prng = ReturnType<typeof prng>;

const TODAY = "2026-11-04";
const FIRST_DAY = "2025-06-01";
const LIVE: BusinessLocation[] = [
  { id: "loc-w1", name: "North warehouse", kind: "warehouse", floorAreaSqFt: "12000" },
  { id: "loc-w2", name: "South warehouse", kind: "warehouse", floorAreaSqFt: "8000" },
  { id: "loc-s1", name: "Riverside showroom", kind: "showroom", floorAreaSqFt: "2500" },
  { id: "loc-s2", name: "Hilltop showroom", kind: "showroom" },
];
/** A location id that appears only on documents: the location was removed after they were written. */
const REMOVED = "loc-gone";
const ON_DOCUMENTS = [...LIVE.map((l) => l.id), REMOVED];
const REPS = ["rep-1", "rep-2", "rep-3"];
const SUPPLIERS = ["sup-a", "sup-b"];
const PRODUCTS = [
  { id: "prod-1", category: "carpet" as const },
  { id: "prod-2", category: "lvp" as const },
  { id: "prod-3", category: "laminate" as const },
];
const EXPENSE_KINDS: ExpenseCategory[] = ["rent", "marketing", "supplies", "insurance", "taxes_licenses", "other"];
const daysToToday = (Date.parse(TODAY) - Date.parse(FIRST_DAY)) / 86_400_000;
const day = (r: Prng) => addDays(FIRST_DAY, r.int(daysToToday + 1));

function line(r: Prng, n: number): DocLine {
  const product = r.chance(80) ? r.pick(PRODUCTS) : null;
  return {
    id: `line-${n}`,
    productId: product?.id,
    description: "Line",
    category: product ? "material" : r.pick(["labor", "freight", "service"] as const),
    unit: "sq_ft",
    quantity: `${r.int(800)}.${r.int(1000)}`,
    unitPrice: r.money(60),
    unitCost: `${r.int(40)}.${String(r.int(10000)).padStart(4, "0")}`,
  };
}

function invoice(r: Prng, n: number): BusinessInvoice {
  const issuedAt = day(r);
  const at = r.pick(ON_DOCUMENTS);
  const base = {
    id: `inv-${n}`,
    number: `INV-${n}`,
    salesRepId: r.pick(REPS),
    locationId: r.pick(["loc-w1", "loc-w2"]),
    issuedAt,
    dueAt: r.chance(80) ? addDays(issuedAt, 30) : null,
    voidedAt: r.chance(6) ? `${addDays(issuedAt, 2)}T10:00` : null,
    isReturn: r.chance(8),
    depositPct: "0",
    ...(r.chance(60) ? { soldAtLocationId: at } : {}),
  };
  if (base.isReturn && r.chance(50)) {
    // A credit note issued in the app: amounts and no lines (ADR 0025).
    const subtotal = r.money(900);
    const amount = dec(subtotal).isZero() ? "10.00" : subtotal;
    return { ...base, lines: [], subtotal: amount, tax: "0.00", total: amount, cost: r.money(400) };
  }
  const lines = Array.from({ length: 1 + r.int(4) }, (_, k) => line(r, n * 10 + k));
  const totals = computeTotals(lines, { rule: undefined, exempt: false, rounding: "invoice" });
  return { ...base, lines, subtotal: totals.subtotal, tax: totals.tax, total: totals.total, cost: totals.cost };
}

function expense(r: Prng, n: number): BusinessExpense {
  const payroll = r.chance(12);
  return {
    id: `exp-${n}`,
    number: `EXP-${n}`,
    date: day(r),
    supplierId: r.chance(80) ? r.pick(SUPPLIERS) : null,
    category: payroll ? "payroll" : r.chance(5) ? "sales_tax_payment" : r.pick(EXPENSE_KINDS),
    locationId: r.chance(45) ? null : r.pick(ON_DOCUMENTS),
    amount: r.money(5000),
    tax: r.chance(40) ? r.money(300) : "0.00",
    status: r.pick(["confirmed", "confirmed", "confirmed", "pending", "voided"] as const),
    settlement: r.pick(["paid", "on_account"] as const),
  };
}

function generate(seed: number): BusinessData {
  const r = prng(seed);
  const invoices: BusinessInvoice[] = [];
  const expenses: BusinessExpense[] = [];
  const adjustments: BusinessAdjustment[] = [];
  const payPeriods: BusinessPayPeriod[] = [];
  const employees: BusinessEmployee[] = Array.from({ length: 8 }, (_, k) => ({
    id: `emp-${k}`,
    name: `Person ${k}`,
    // With a live home location, with none (shared), or with one that was removed.
    homeLocationId: k < 4 ? LIVE[k]!.id : k < 6 ? null : REMOVED,
  }));
  for (let n = 0; n < 300; n += 1) {
    const roll = r.int(100);
    if (roll < 52) invoices.push(invoice(r, n));
    else if (roll < 88) expenses.push(expense(r, n));
    else if (roll < 95 && invoices.length > 0) {
      const target = r.chance(90) ? r.pick(invoices).id : "inv-unknown";
      adjustments.push({
        invoiceId: target,
        kind: r.chance(80) ? "write_off" : "credit_applied",
        amount: r.money(80),
        at: `${day(r)}T15:30`,
      });
    } else {
      const end = day(r);
      payPeriods.push({
        status: r.pick(["approved", "exported", "exported", "open", "in_review"] as const),
        end,
        lines: employees.filter(() => r.chance(70)).map((e) => ({ employeeId: e.id, grossPay: r.money(4000) })),
      });
    }
  }
  const pcts = [r.int(40), r.int(30), r.int(20)];
  const sharedCosts = r.pick<SharedCostSettings>([
    { rule: "revenue", fixedPct: {} },
    { rule: "floor_area", fixedPct: {} },
    { rule: "equal", fixedPct: {} },
    {
      rule: "fixed",
      fixedPct: {
        "loc-w1": String(pcts[0]),
        "loc-w2": String(pcts[1]),
        "loc-s1": String(pcts[2]),
        "loc-s2": String(100 - pcts[0]! - pcts[1]! - pcts[2]!),
      },
    },
  ]);
  return {
    invoices,
    payments: [],
    adjustments,
    refunds: [],
    expenses,
    bills: [],
    supplierPayments: [],
    receipts: [],
    purchaseOrders: [],
    suppliers: SUPPLIERS.map((id) => ({ id, name: `Vendor ${id}` })),
    users: REPS.map((id) => ({ id, name: `Rep ${id}` })),
    employees,
    locations: LIVE,
    productCategories: PRODUCTS,
    products: [],
    rolls: [],
    stockMovements: [],
    payPeriods,
    settings: { sharedCosts },
    today: TODAY,
  };
}

/** Filters the API accepts (ADR 0055 S8, S10): a period of at most 366 days, live location ids only. */
function filtersFor(r: Prng): BusinessFilters {
  const from = addDays(FIRST_DAY, r.int(daysToToday + 60));
  const to = addDays(from, r.int(366));
  return {
    from,
    to,
    locationIds: r.chance(40) ? [] : LIVE.map((l) => l.id).filter(() => r.chance(50)),
    // The spec's known limits: a product category or salesperson filter is not expected to add up (rule 22).
    productCategory: null,
    expenseCategory: r.chance(25) ? r.pick(EXPENSE_KINDS) : null,
    salesRepId: null,
    supplierId: r.chance(20) ? r.pick([...SUPPLIERS, "sup-unknown"]) : null,
  };
}

/**
 * The document invariant every invoice the app writes holds (computeTotals; ADR 0025): with lines,
 * subtotal = Σ lineAmount and cost = Σ roundMoney(quantity × unitCost); without lines (a credit
 * note), a non-zero subtotal, so `salesLines` counts it as one line of its subtotal and cost. The
 * gate rests on it: Summary revenue adds up lines, Profit by location adds up subtotals.
 */
function holdsInvariant(i: BusinessInvoice): boolean {
  if (i.lines.length === 0) return !dec(i.subtotal).isZero() || dec(i.cost).isZero();
  return (
    sum(i.lines.map(lineAmount)).eq(i.subtotal) &&
    sum(i.lines.map((l) => roundMoney(dec(l.quantity).times(l.unitCost)))).eq(i.cost)
  );
}

const PAY: BusinessVisibility = { margin: true, payroll: true, people: true, stock: true };
const NO_PAY: BusinessVisibility = { ...PAY, payroll: false, people: false };

describe("the week-18 gate: location profits add up to company profit (S-GATE-1)", () => {
  it("holds for 40 random companies of 300 documents, with and without pay sight", () => {
    let removedRows = 0;
    let checks = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const data = generate(seed * 7919);
      for (const i of data.invoices) expect(holdsInvariant(i), `seed ${seed}, ${i.id}`).toBe(true);
      const r = prng(seed);
      for (let run = 0; run < 3; run += 1) {
        const filters = filtersFor(r);
        for (const show of [PAY, NO_PAY]) {
          const report = businessReport(data, filters, show);
          const total = sectionOf(report, "locations").total!.values;
          const where = `seed ${seed}, ${JSON.stringify(filters)}, payroll ${show.payroll}`;
          expect(total.net, where).toBe(summaryValue(report, "net"));
          expect(total.revenue, where).toBe(summaryValue(report, "revenue"));
          const gone = sectionOf(report, "locations").rows.find((row) => row.id === REMOVED);
          if (filters.locationIds.length > 0) expect(gone, where).toBeUndefined();
          else if (gone) {
            expect(gone.label).toBe("Removed location");
            expect(gone.values.shared).toBe("0.00");
            removedRows += 1;
          }
          checks += 1;
        }
      }
    }
    expect(checks).toBe(240);
    expect(removedRows).toBeGreaterThan(20);
  });

  it("lists live locations first, then removed ones, and only the picked ones when some are picked", () => {
    const data = generate(11);
    const all = businessReport(data, { from: "2026-01-01", to: "2026-10-31", ...NO_FILTERS }, PAY);
    expect(sectionOf(all, "locations").rows.map((row) => row.id)).toEqual([...LIVE.map((l) => l.id), REMOVED]);
    const picked = businessReport(
      data,
      { from: "2026-01-01", to: "2026-10-31", ...NO_FILTERS, locationIds: ["loc-s1", "loc-w1"] },
      PAY,
    );
    expect(sectionOf(picked, "locations").rows.map((row) => row.id)).toEqual(["loc-w1", "loc-s1"]);
    const byLocation = sectionOf(all, "expense_location").rows.find((row) => row.id === REMOVED);
    expect(byLocation?.label).toBe("Removed location");
  });
});

describe("without pay sight no figure holds pay (ADR 0055 S3, S-GATE-2)", () => {
  it("drops pay everywhere, and operating expenses are cost expenses plus bad debts", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const data = generate(seed * 104_729);
      const r = prng(seed + 1000);
      const filters = { ...filtersFor(r), locationIds: [] };
      const report = businessReport(data, filters, NO_PAY);
      const where = `seed ${seed}, ${JSON.stringify(filters)}`;
      for (const { row } of rowsOf(report)) {
        for (const record of row.records) {
          expect(record.label.startsWith("Gross pay"), where).toBe(false);
          expect(record.label, where).not.toBe("Payroll");
        }
      }
      expect(report.sections.map((s) => s.key)).not.toContain("people");
      const invoices = new Set(data.invoices.map((i) => i.id));
      const badDebts = sum(
        data.adjustments
          .filter(
            (a) =>
              a.kind === "write_off" &&
              inRange(a.at.slice(0, 10), filters.from, filters.to) &&
              invoices.has(a.invoiceId),
          )
          .map((a) => a.amount),
      );
      const expenses = sectionOf(report, "expense_category").total!.values.amount!;
      expect(dec(summaryValue(report, "opex")!).minus(expenses).eq(badDebts), where).toBe(true);
      const summary = sectionOf(report, "summary");
      expect(summary.rows.find((row) => row.id === "opex")!.label).toBe("Operating expenses, excluding people costs");
      expect(summary.rows.find((row) => row.id === "net")!.label).toBe(
        "Net profit, before people costs and income tax",
      );
      expect(summary.note).toContain("People costs are left out, because your access doesn't include pay periods.");
      expect(sectionOf(report, "locations").note).toMatch(/Direct expenses leave out people costs\.$/);
    }
  });

  it("keeps the spec's labels with pay sight", () => {
    const data = generate(3);
    const report = businessReport(data, { from: "2026-01-01", to: "2026-06-30", ...NO_FILTERS }, PAY);
    const summary = sectionOf(report, "summary");
    expect(summary.rows.find((row) => row.id === "opex")!.label).toBe("Operating expenses");
    expect(summary.rows.find((row) => row.id === "net")!.label).toBe("Net profit, before income tax");
    expect(summary.note ?? "").not.toContain("People costs are left out");
    expect(sectionOf(report, "locations").note ?? "").not.toContain("people costs");
    expect(report.sections.map((s) => s.key)).toContain("people");
  });
});
