import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateFixtures } from "../scripts/fixtures/generate";
import {
  addDays,
  agingSummary,
  billLedger,
  ledgerIndex,
  openAmounts,
  boxedStock,
  computeTotals,
  customerReceivable,
  daysBetween,
  dec,
  inventoryValuation,
  lineAmount,
  moneyString,
  openInvoices,
  receivablesSummary,
  receivedValue,
  resolveTaxRule,
  rollAreaSqFt,
  splitOvertime,
  sum,
  adjustmentNeedsApproval,
  billLedgerIndex,
  payablesSummary,
  rateFor,
  roundMoney,
  ruleFor,
  teamStats,
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
  it("invoice total = sum of lines + tax, recomputed with the tax rule for its job site and date", () => {
    const { tax, region } = f.settings.localization;
    for (const inv of f.invoices) {
      const { rule } = resolveTaxRule(tax, region.statesOfOperation, inv.jobSite, inv.issuedAt);
      expect(rule?.ratePct ?? null, inv.number).toBe(inv.taxRule?.ratePct ?? null);
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

  const ledgers = ledgerIndex(f.invoices, { payments: f.payments, adjustments: f.invoiceAdjustments }, today);

  it("payments never exceed an invoice's total, and each has a number, a reference and proof", () => {
    for (const inv of f.invoices.filter((i) => !i.isReturn)) {
      const paid = sum(f.payments.filter((p) => p.invoiceId === inv.id).map((p) => p.amount));
      expect(paid.lte(inv.total), inv.number).toBe(true);
    }
    for (const p of f.payments) {
      expect(p.date <= today, p.number).toBe(true);
      expect(p.files.length, p.number).toBeGreaterThan(0);
      expect(p.method === "cash" || p.reference !== "", p.number).toBe(true);
    }
    expect(new Set(f.payments.map((p) => p.number)).size).toBe(f.payments.length);
  });

  it("settles returns by refund: they owe nothing, give no credit and have no customer payment", () => {
    for (const ret of f.invoices.filter((i) => i.isReturn)) {
      expect(ledgers.get(ret.id)).toMatchObject({ state: "return", balance: "0.00" });
      expect(ret.refundedAt).not.toBeNull();
      expect(f.payments.some((p) => p.invoiceId === ret.id)).toBe(false);
    }
  });

  it("receivables = open invoices: the ledger balances, which aging adds up to", () => {
    const open = openInvoices(f.invoices, ledgers);
    const aging = agingSummary(openAmounts(f.invoices, ledgers), today);
    expect(aging.total).toBe(moneyString(sum(open.map((i) => ledgers.get(i.id)!.balance))));
    for (const inv of open) {
      const settled = sum(
        f.payments.filter((p) => p.invoiceId === inv.id && p.status === "confirmed").map((p) => p.amount),
      );
      expect(ledgers.get(inv.id)!.balance, inv.number).toBe(moneyString(dec(inv.total).minus(settled)));
    }
    const buckets = sum([aging.current, aging.d30, aging.d60, aging.d90, aging.d90plus]);
    expect(moneyString(buckets)).toBe(aging.total);
  });

  it("inventory valuation = rolls remaining × their cost + boxed quantity × average cost", () => {
    const rolls = sum(f.rolls.map((r) => rollAreaSqFt(r.widthFt, r.remainingLengthFt).times(r.costPerSqFt)));
    const onHand = boxedStock(f.stockMovements);
    const boxed = sum(f.products.map((p) => (onHand.get(p.id) ?? dec(0)).times(p.cost)));
    const valuation = inventoryValuation(f.rolls, f.products, onHand);
    expect(valuation.rolls).toBe(moneyString(rolls));
    expect(valuation.boxed).toBe(moneyString(boxed));
    expect(valuation.total).toBe(moneyString(rolls.plus(boxed)));
  });

  it("payables = open bills: bills match their receipts, supplier payments never exceed a bill", () => {
    for (const bill of f.bills) {
      const ledger = billLedger(bill, f.supplierPayments, today);
      expect(dec(ledger.paid).lte(bill.total), bill.number).toBe(true);
      const po = f.purchaseOrders.find((p) => p.id === bill.poId)!;
      const receipts = f.receipts.filter((r) => bill.receiptIds.includes(r.id));
      expect(moneyString(receivedValue(po, receipts)), bill.number).toBe(bill.total);
    }
    for (const p of f.supplierPayments) {
      expect(moneyString(sum(p.allocations.map((x) => x.amount))), p.number).toBe(p.amount);
      expect(p.files.length, p.number).toBeGreaterThan(0);
    }
    expect(f.bills.some((x) => dec(billLedger(x, f.supplierPayments, today).balance).gt(0))).toBe(true);
    const owed = sum(f.bills.map((x) => billLedger(x, f.supplierPayments, today).balance));
    expect(payablesSummary(f.bills, billLedgerIndex(f.bills, f.supplierPayments, today), today).total).toBe(
      moneyString(owed),
    );
  });

  it("every stock adjustment has a reason, and only approved ones moved stock", () => {
    expect(f.stockAdjustments.length).toBeGreaterThan(0);
    for (const a of f.stockAdjustments) {
      const moved = f.stockMovements.filter((m) => m.source.kind === "adjustment" && m.source.id === a.id);
      expect(
        moved.map((m) => m.quantity),
        a.number,
      ).toEqual(a.status === "approved" ? [a.quantity] : []);
      expect(a.status === "pending", a.number).toBe(
        adjustmentNeedsApproval(a.quantity, f.settings.inventory.adjustmentApprovalQty),
      );
    }
  });

  it("stock by warehouse = movements: never negative, never in a showroom, transfers balance", () => {
    const warehouses = new Set(f.locations.filter((l) => l.kind === "warehouse").map((l) => l.id));
    for (const m of f.stockMovements) expect(warehouses.has(m.locationId), m.id).toBe(true);
    for (const id of warehouses) {
      for (const [productId, qty] of boxedStock(f.stockMovements, id)) expect(qty.gte(0), productId).toBe(true);
    }
    for (const t of f.transfers) {
      const lines = f.stockMovements.filter((m) => m.source.id === t.id);
      const net = sum(lines.map((m) => m.quantity));
      const boxedQty = sum(t.lines.filter((l) => !l.rollId).map((l) => l.quantity));
      expect(net.toString(), t.number).toBe(t.status === "received" ? "0" : boxedQty.negated().toString());
    }
    for (const roll of f.rolls) {
      expect(warehouses.has(roll.locationId), roll.rollNumber).toBe(true);
      const travelling = f.transfers.find((t) =>
        t.lines.some((l) => l.rollId === roll.id && t.status === "in_transit"),
      );
      expect(roll.transferId, roll.rollNumber).toBe(travelling?.id ?? null);
    }
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

  it("commissions earned = the rule's rate × the revenue in each rep's confirmed payments", () => {
    const ledgers = ledgerIndex(f.invoices, { payments: f.payments, adjustments: f.invoiceAdjustments }, today);
    const range = { from: addDays(today, -89), to: today, today };
    const rows = teamStats({ ...f, rules: f.settings.commissions.rules, ledgers }, range);
    for (const row of rows) {
      const user = f.users.find((u) => u.id === row.userId)!;
      const rule = ruleFor(user, f.roles, f.settings.commissions.rules);
      const own = new Map(f.invoices.filter((i) => i.salesRepId === user.id && !i.voidedAt).map((i) => [i.id, i]));
      const paid = f.payments.filter(
        (p) => p.status === "confirmed" && own.has(p.invoiceId) && p.date >= range.from && p.date <= range.to,
      );
      const revenue = sum(
        paid.map((p) => {
          const invoice = own.get(p.invoiceId)!;
          return dec(invoice.total).isZero()
            ? dec(0)
            : roundMoney(dec(p.amount).times(invoice.subtotal).div(invoice.total));
        }),
      );
      expect(row.paidRevenue, row.name).toBe(moneyString(revenue));
      if (rule?.basis === "paid_revenue") {
        expect(row.earned, row.name).toBe(moneyString(revenue.times(rateFor(rule, revenue)).div(100)));
      }
    }
    expect(rows.some((r) => dec(r.earned).gt(0))).toBe(true);
  });

  it("HR commissions are 4 % of each rep's net invoiced sales", () => {
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
    const summitLedgers = ledgerIndex(summit.invoices, { payments: summit.payments, adjustments: [] }, today);
    const overdue = sales.filter((i) => summitLedgers.get(i.id)!.overdue).length / sales.length;
    expect(overdue).toBeGreaterThan(0.08);
    expect(overdue).toBeLessThan(0.16);
    expect(summit.invoices.length - sales.length).toBeGreaterThanOrEqual(5);
  });

  it("has 4 crews, 3 subcontractors and 40 jobs in the past, today and upcoming, plus one not invoiced", () => {
    expect(summit.crews.filter((c) => c.kind === "crew")).toHaveLength(4);
    expect(summit.crews.filter((c) => c.kind === "subcontractor")).toHaveLength(3);
    expect(summit.jobs.filter((j) => j.invoiceId)).toHaveLength(40);
    const unbilled = summit.jobs.filter((j) => !j.invoiceId);
    expect(unbilled).toHaveLength(1);
    expect(summit.quotes.some((q) => q.customerId === unbilled[0]!.customerId && q.status === "accepted")).toBe(true);
    expect(summit.jobs.filter((j) => j.date < today).length).toBeGreaterThan(0);
    expect(summit.jobs.filter((j) => j.date === today).length).toBeGreaterThan(0);
    expect(summit.jobs.filter((j) => j.date > today).length).toBeGreaterThan(0);
    for (const job of summit.jobs.filter((j) => j.invoiceId)) {
      expect(job.revenue).toBe(summit.invoices.find((i) => i.id === job.invoiceId)!.subtotal);
    }
  });

  it("has the HR headcounts, 8 weeks of timesheets with overtime, and W-2 and 1099 workers", () => {
    expect([summit, keystone, harbor].map((f) => f.employees.length)).toEqual([19, 13, 30]);
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

describe("receivables (spec B5)", () => {
  for (const f of [summit, keystone]) {
    const today = f.anchorDate;
    const ledgers = ledgerIndex(f.invoices, { payments: f.payments, adjustments: f.invoiceAdjustments }, today);
    const summary = receivablesSummary(f.invoices, ledgers, today);

    it(`${f.companyId}: current and overdue add up to the open balance and the aging`, () => {
      expect(moneyString(dec(summary.current).plus(summary.overdue))).toBe(summary.total);
      expect(agingSummary(openAmounts(f.invoices, ledgers), today).total).toBe(summary.total);
      const byCustomer = sum(f.customers.map((c) => customerReceivable(c.id, f.invoices, ledgers).open));
      expect(moneyString(byCustomer)).toBe(summary.total);
    });

    it(`${f.companyId}: looks like a healthy business, under 15 % overdue and little over 90 days`, () => {
      const aging = agingSummary(openAmounts(f.invoices, ledgers), today);
      expect(dec(summary.overdue).div(summary.total).toNumber()).toBeLessThan(0.15);
      expect(dec(aging.d90plus).div(summary.total).toNumber()).toBeLessThan(0.03);
    });
  }
});
