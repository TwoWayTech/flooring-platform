import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateFixtures } from "../scripts/fixtures/generate";
import {
  addDays,
  agingSummary,
  balance,
  computeTotals,
  daysBetween,
  dec,
  inventoryValuation,
  isOverdue,
  lineAmount,
  moneyString,
  openInvoices,
  rollAreaSqFt,
  splitOvertime,
  sum,
  type CompanyFixtures,
  type PlatformFixtures,
} from "../src";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8")) as T;

const platform = load<PlatformFixtures>("platform");
const summit = load<CompanyFixtures>("summit");
const keystone = load<CompanyFixtures>("keystone");
const harbor = load<CompanyFixtures>("harbor");
const flooring = [summit, keystone];
const today = summit.anchorDate;

describe("fixed seed", () => {
  it("regenerates exactly the committed fixtures (run `pnpm fixtures` after changing the generator)", () => {
    const fresh = generateFixtures();
    expect(JSON.parse(JSON.stringify(fresh.platform))).toEqual(platform);
    for (const company of fresh.companies) {
      expect(JSON.parse(JSON.stringify(company)), company.companyId).toEqual(load(company.companyId));
    }
  });
});

describe.each(flooring.map((f) => [f.companyId, f] as const))("%s documents reconcile (spec section 4)", (_, f) => {
  it("invoice total = sum of lines + tax, recomputed with the stored tax rule", () => {
    const rules = f.settings.localization.tax.rules;
    for (const inv of f.invoices) {
      const rule = inv.taxRule ? rules.find((r) => r.state === inv.taxRule!.state) : undefined;
      const quote = f.quotes.find((q) => q.id === inv.quoteId);
      const totals = computeTotals(inv.lines, {
        rule,
        exempt: inv.taxExempt,
        rounding: f.settings.localization.tax.rounding,
        lumpSum: quote?.lumpSum ?? false,
      });
      expect(inv.subtotal, inv.number).toBe(moneyString(sum(inv.lines.map(lineAmount))));
      expect(inv.total, inv.number).toBe(moneyString(dec(inv.subtotal).plus(inv.tax)));
      expect([totals.subtotal, totals.tax, totals.cost], inv.number).toEqual([inv.subtotal, inv.tax, inv.cost]);
    }
  });

  it("payments match each invoice's paid amount and never exceed its total", () => {
    for (const inv of f.invoices.filter((i) => !i.isReturn)) {
      const paid = sum(f.payments.filter((p) => p.invoiceId === inv.id).map((p) => p.amount));
      expect(moneyString(paid), inv.number).toBe(inv.paid);
      expect(paid.lte(inv.total), inv.number).toBe(true);
      expect(f.payments.every((p) => p.at <= today)).toBe(true);
    }
  });

  it("settles returns by refund: paid equals total and no customer payment is recorded", () => {
    for (const ret of f.invoices.filter((i) => i.isReturn)) {
      expect(ret.paid).toBe(ret.total);
      expect(f.payments.some((p) => p.invoiceId === ret.id)).toBe(false);
    }
  });

  it("receivables aging sums to the open invoices", () => {
    const open = openInvoices(f.invoices);
    const aging = agingSummary(open, today);
    expect(aging.total).toBe(moneyString(sum(open.map(balance))));
    const buckets = sum([aging.current, aging.d30, aging.d60, aging.d90, aging.d90plus]);
    expect(moneyString(buckets)).toBe(aging.total);
  });

  it("inventory valuation = rolls remaining × their cost + cartons × average cost", () => {
    const rolls = sum(f.rolls.map((r) => rollAreaSqFt(r.widthFt, r.remainingLengthFt).times(r.costPerSqFt)));
    const boxed = sum(f.products.map((p) => dec(p.cartonsOnHand ?? 0).times(p.cost)));
    const valuation = inventoryValuation(f.rolls, f.products);
    expect(valuation.rolls).toBe(moneyString(rolls));
    expect(valuation.boxed).toBe(moneyString(boxed));
    expect(valuation.total).toBe(moneyString(rolls.plus(boxed)));
  });

  it("bills, bill payments and purchase orders add up", () => {
    for (const bill of f.bills) {
      const paid = sum(f.billPayments.filter((p) => p.billId === bill.id).map((p) => p.amount));
      expect(moneyString(paid), bill.number).toBe(bill.paid);
      expect(paid.lte(bill.total), bill.number).toBe(true);
      expect(bill.total).toBe(f.purchaseOrders.find((po) => po.id === bill.poId)!.total);
    }
    expect(f.bills.some((b) => balance(b).gt(0))).toBe(true);
  });

  it("rolls: remaining = original - cuts, and remnants are under 12 ft", () => {
    for (const roll of f.rolls) {
      const cut = sum(roll.cuts.map((c) => c.lengthFt));
      expect(dec(roll.originalLengthFt).minus(cut).toString(), roll.rollNumber).toBe(
        dec(roll.remainingLengthFt).toString(),
      );
      if (roll.isRemnant) expect(Number(roll.remainingLengthFt)).toBeLessThan(12);
    }
  });

  it("commissions are 4 % of each rep's net invoiced sales", () => {
    for (const c of f.commissions) expect(c.amount).toBe(moneyString(dec(c.sales).times(c.ratePct).dividedBy(100)));
  });
});

describe("spec section 4 volumes", () => {
  it("has the catalog, rolls and customers", () => {
    for (const f of flooring) {
      expect(f.products).toHaveLength(120);
      expect(f.rolls).toHaveLength(60);
      expect(f.rolls.filter((r) => r.isRemnant)).toHaveLength(15);
      expect(f.customers).toHaveLength(80);
    }
    const mix = (type: string) => summit.customers.filter((c) => c.type === type).length;
    expect([mix("homeowner"), mix("dealer"), mix("contractor")]).toEqual([50, 18, 12]);
  });

  it("has 6 tax-exempt customers, 2 of them with certificates expiring within 30 days", () => {
    const exempt = summit.customers.filter((c) => c.taxExempt && c.certificate);
    expect(exempt).toHaveLength(6);
    expect(exempt.filter((c) => daysBetween(today, c.certificate!.expiresAt) <= 30)).toHaveLength(2);
  });

  it("has about 300 quotes and 220 invoices, about 12 % overdue and 3 % returns", () => {
    const sales = summit.invoices.filter((i) => !i.isReturn);
    expect(summit.quotes).toHaveLength(300);
    expect(sales).toHaveLength(220);
    const overdue = sales.filter((i) => isOverdue(i, today)).length / sales.length;
    expect(overdue).toBeGreaterThan(0.08);
    expect(overdue).toBeLessThan(0.16);
    expect(summit.invoices.length - sales.length).toBeGreaterThanOrEqual(5);
  });

  it("has 4 crews, 3 subcontractors and 40 jobs in the past, today and upcoming", () => {
    expect(summit.crews.filter((c) => c.kind === "crew")).toHaveLength(4);
    expect(summit.crews.filter((c) => c.kind === "subcontractor")).toHaveLength(3);
    expect(summit.jobs).toHaveLength(40);
    expect(summit.jobs.filter((j) => j.date < today).length).toBeGreaterThan(0);
    expect(summit.jobs.filter((j) => j.date === today).length).toBeGreaterThan(0);
    expect(summit.jobs.filter((j) => j.date > today).length).toBeGreaterThan(0);
    for (const job of summit.jobs) {
      expect(job.revenue).toBe(summit.invoices.find((i) => i.id === job.invoiceId)!.subtotal);
    }
  });

  it("has the HR headcounts, 8 weeks of timesheets with overtime, and W-2 and 1099 workers", () => {
    expect([summit, keystone, harbor].map((f) => f.employees.length)).toEqual([18, 12, 30]);
    for (const f of [summit, keystone, harbor]) {
      const weeks = new Set(f.timesheets.map((t) => t.weekStart));
      expect(weeks.size).toBe(8);
      expect(f.timesheets.some((t) => splitOvertime(t.days, "federal").overtime > 0)).toBe(true);
    }
    expect(harbor.employees.some((e) => e.workerType === "1099")).toBe(true);
    expect(harbor.employees.some((e) => e.state === "CA")).toBe(true);
  });

  it("has 25 meetings across companies, some recurring", () => {
    const meetings = [summit, keystone, harbor].flatMap((f) => f.meetings);
    expect(meetings).toHaveLength(25);
    expect(meetings.some((m) => m.recurrence !== "none")).toBe(true);
  });

  it("keeps the HR-only company free of flooring data", () => {
    expect(harbor.products).toHaveLength(0);
    expect(harbor.invoices).toHaveLength(0);
    expect(
      platform.companies.find((c) => c.id === "harbor")!.ceiling.every((k) => /^(hr|meetings|settings)\./.test(k)),
    ).toBe(true);
  });

  it("anchors every document on or before the anchor date, except planned jobs and meetings", () => {
    expect(summit.invoices.every((i) => i.issuedAt <= today)).toBe(true);
    expect(summit.jobs.every((j) => j.date <= addDays(today, 14))).toBe(true);
  });
});
