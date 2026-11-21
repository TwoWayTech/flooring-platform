import { describe, expect, it } from "vitest";
import {
  bestSellersIn,
  dec,
  invoicesIn,
  knownPnl,
  last12Months,
  marginPct,
  marginSeries,
  moneyString,
  monthlyPnl,
  pnlReport,
  pnlTotals,
  salesTotals,
  SENSITIVE,
  signedCost,
  signedSubtotal,
  sparkSeries,
  storedPnl,
  sum,
  sumKnown,
  teamStats,
  type CompanyFixtures,
  type DocLine,
  type PermissionKey,
  type PnlMonth,
  type SellerMetric,
  type ViewedDocLine,
  type ViewedInvoice,
} from "../src";
import { businessDataOf, loadFixtures } from "./report-fixtures";
import { invoicesAsSent, SALES } from "./viewed-records";

const summit = loadFixtures("summit");
const keystone = loadFixtures("keystone");
/** The fixtures' anchor day; both companies' invoices end on it. */
const ANCHOR = "2026-11-04";
const MONTHS = last12Months(ANCHOR);
const COMPANIES = [summit, keystone].map((f) => [f.companyId, f] as const);

/**
 * Margin and product cost without contract cost: a custom role, or the Owner of a company with the
 * Contracts module off, whose effective keys lose `contracts.*` (ADR 0055 R-MODULES-OFF).
 */
const NO_CONTRACT_COST: ReadonlySet<PermissionKey> = new Set([SENSITIVE.margin, SENSITIVE.productCost]);

const NO_PNL = "An invoice has no cost, so the profit and loss can't be worked out.";

/** A month's cost of goods from invoices that all carry cost, the oracle's own read. */
function cogsOf(month: PnlMonth): string {
  if (month.cogs === null) throw new Error(`${month.month} has an unknown cost of goods in the full fixtures.`);
  return month.cogs;
}

/** A month's figures that never depend on cost. */
const costFree = (months: readonly PnlMonth[]) =>
  months.map((m) => ({ month: m.month, revenue: m.revenue, expenses: m.expenses }));

/** Every figure worked out from cost, unknown. */
const UNKNOWN_COST = { cogs: null, grossMargin: null, grossMarginPct: null, netIncome: null };

/** The months a company's contract invoices fall in (each arrives without cost for NO_CONTRACT_COST). */
const contractMonths = (f: CompanyFixtures) =>
  [...new Set(f.invoices.filter((i) => i.contractId).map((i) => i.issuedAt.slice(0, 7)))].sort();

describe("monthlyPnl over invoices as received (sales.md rule 13; ADR 0037, 2026-11-17)", () => {
  describe.each(COMPANIES)("%s", (_, f) => {
    const full = monthlyPnl(MONTHS, f.invoices, f.expenses);

    it("leaves every month's cost of goods unknown for Sales, and its revenue and expenses as they are", () => {
      expect(MONTHS.every((month) => f.invoices.some((i) => !i.voidedAt && i.issuedAt.startsWith(month)))).toBe(true);
      const seen = monthlyPnl(MONTHS, invoicesAsSent(f.invoices, SALES), f.expenses);
      expect(costFree(seen)).toEqual(costFree(full));
      for (const month of seen) expect(month).toMatchObject(UNKNOWN_COST);
    });

    it("leaves only the contract months unknown without contract cost, all or nothing per month", () => {
      expect(contractMonths(f)).toEqual(["2026-09", "2026-10"]);
      const seen = monthlyPnl(MONTHS, invoicesAsSent(f.invoices, NO_CONTRACT_COST), f.expenses);
      seen.forEach((month, i) => {
        if (contractMonths(f).includes(month.month)) {
          expect(month).toEqual({ ...full[i], ...UNKNOWN_COST });
        } else {
          expect(month).toEqual(full[i]);
        }
      });
    });
  });

  it("gives a month with no invoices a known zero, so the 12 months stay known", () => {
    expect(summit.invoices.some((i) => i.issuedAt.startsWith("2026-12"))).toBe(false);
    expect(summit.expenses.some((e) => e.date.startsWith("2026-12"))).toBe(false);
    const [december] = monthlyPnl(["2026-12"], invoicesAsSent(summit.invoices, SALES), summit.expenses);
    expect(december).toEqual({
      month: "2026-12",
      revenue: "0.00",
      cogs: "0.00",
      grossMargin: "0.00",
      grossMarginPct: "0",
      expenses: "0.00",
      netIncome: "0.00",
    });
    const withDecember = monthlyPnl(["2026-12", ...MONTHS], summit.invoices, summit.expenses);
    const known = knownPnl(withDecember);
    expect(known).not.toBeNull();
    expect(known![0]).toEqual(december);
    expect(pnlTotals(withDecember).margin).not.toBeNull();
  });

  it("treats cost: null and a missing cost alike, and never adds up part of a month", () => {
    const invoice = summit.invoices.find((i) => !i.isReturn && !i.contractId && i.issuedAt.startsWith("2026-08"))!;
    const month = invoice.issuedAt.slice(0, 7);
    const nullCost: ViewedInvoice = { ...invoice, cost: null };
    const missing: ViewedInvoice = { ...invoice };
    delete missing.cost;
    for (const seen of [[nullCost], [missing], [invoice, nullCost]]) {
      const [only] = monthlyPnl([month], seen, []);
      expect(only).toMatchObject(UNKNOWN_COST);
    }
  });
});

describe("knownPnl and pnlTotals: the 12-month panel's margin is all or nothing (spec E1)", () => {
  describe.each(COMPANIES)("%s", (_, f) => {
    const full = monthlyPnl(MONTHS, f.invoices, f.expenses);
    const forSales = () => monthlyPnl(MONTHS, invoicesAsSent(f.invoices, SALES), f.expenses);
    const withoutContractCost = () => monthlyPnl(MONTHS, invoicesAsSent(f.invoices, NO_CONTRACT_COST), f.expenses);

    it("knownPnl gives every month with every figure, or nothing", () => {
      const known = knownPnl(full);
      expect(known).toEqual(full);
      expect(known!.every((m) => Object.values(m).every((value) => typeof value === "string"))).toBe(true);
      expect(knownPnl(forSales())).toBeNull();
      expect(knownPnl(withoutContractCost())).toBeNull();
    });

    it("pnlTotals gives the hook's old totals with every cost known", () => {
      const revenue = sum(full.map((m) => m.revenue));
      const cogs = sum(full.map(cogsOf));
      expect(pnlTotals(full)).toEqual({
        revenue: moneyString(revenue),
        margin: {
          grossMargin: moneyString(revenue.minus(cogs)),
          marginPct: marginPct(revenue, cogs).toString(),
          months: full,
        },
      });
    });

    it("pnlTotals keeps revenue and gives no margin when a month is unknown, never one over the known months", () => {
      const revenue = moneyString(sum(full.map((m) => m.revenue)));
      expect(pnlTotals(forSales())).toEqual({ revenue, margin: null });
      expect(pnlTotals(withoutContractCost())).toEqual({ revenue, margin: null });
    });
  });
});

describe("storedPnl: the stored profit and loss never takes an unknown cost (ADR 0037, 2026-11-17)", () => {
  const full = monthlyPnl(MONTHS, summit.invoices, summit.expenses);

  it("refuses months with an unknown cost of goods", () => {
    expect(() => storedPnl(monthlyPnl(MONTHS, invoicesAsSent(summit.invoices, SALES), summit.expenses))).toThrow(
      NO_PNL,
    );
  });

  it("returns stored months unchanged", () => {
    expect(storedPnl(full)).toEqual(full);
  });

  it.each([true, false])("makes pnlReport refuse a browser's invoices, margin flag %s", (margin) => {
    const data = { ...businessDataOf(summit), invoices: invoicesAsSent(summit.invoices, SALES) };
    expect(() => pnlReport({ range: "12m", locationId: null }, data, { margin, payroll: true })).toThrow(NO_PNL);
  });
});

describe("salesTotals over invoices as received (the dashboard's figure cards)", () => {
  const LAST_30 = { from: "2026-10-06", to: ANCHOR };

  it.each(COMPANIES)("%s: keeps revenue and count for Sales and leaves cost and margin unknown", (_, f) => {
    const full = salesTotals(invoicesIn(f.invoices, LAST_30.from, LAST_30.to));
    const seen = salesTotals(invoicesIn(invoicesAsSent(f.invoices, SALES), LAST_30.from, LAST_30.to));
    expect(seen).toEqual({ ...full, cost: null, margin: null, marginPct: null });
  });

  it("is unknown without contract cost over a month with a contract invoice, and known over one without", () => {
    const seen = invoicesAsSent(summit.invoices, NO_CONTRACT_COST);
    expect(invoicesIn(summit.invoices, "2026-10-01", "2026-10-31").some((i) => i.contractId)).toBe(true);
    expect(salesTotals(invoicesIn(seen, "2026-10-01", "2026-10-31"))).toMatchObject({
      cost: null,
      margin: null,
      marginPct: null,
    });
    expect(invoicesIn(summit.invoices, "2026-08-01", "2026-08-31").some((i) => i.contractId)).toBe(false);
    expect(salesTotals(invoicesIn(seen, "2026-08-01", "2026-08-31"))).toEqual(
      salesTotals(invoicesIn(summit.invoices, "2026-08-01", "2026-08-31")),
    );
  });

  it("gives an empty set known zeros", () => {
    expect(salesTotals([])).toEqual({ revenue: "0.00", cost: "0.00", margin: "0.00", marginPct: "0", count: 0 });
  });
});

describe("marginSeries: the Gross margin card's sparkline (spec E1)", () => {
  const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
  const inSeptember = invoicesIn(summit.invoices, SEPTEMBER.from, SEPTEMBER.to);

  it("is unknown when any invoice in the period lacks its cost", () => {
    const stripped = invoicesAsSent(inSeptember, SALES);
    expect(marginSeries(stripped, SEPTEMBER.from, SEPTEMBER.to)).toBeNull();
    expect(marginSeries([...inSeptember.slice(1), stripped[0]!], SEPTEMBER.from, SEPTEMBER.to)).toBeNull();
  });

  it("draws the old signed subtotal less cost per bucket when every cost is known, returns counted against", () => {
    expect(inSeptember.some((i) => i.isReturn)).toBe(true);
    const old = sparkSeries(
      inSeptember,
      (i) => i.issuedAt,
      (i) =>
        dec(i.subtotal)
          .minus(i.cost)
          .times(i.isReturn ? -1 : 1),
      SEPTEMBER.from,
      SEPTEMBER.to,
    );
    expect(marginSeries(inSeptember, SEPTEMBER.from, SEPTEMBER.to)).toEqual(old);
  });

  it("subtracts a return's margin", () => {
    const sale = inSeptember.find((i) => !i.isReturn)!;
    const day = sale.issuedAt;
    const margin = dec(sale.subtotal).minus(sale.cost).toNumber();
    expect(marginSeries([sale], day, day)).toEqual([margin]);
    expect(marginSeries([{ ...sale, isReturn: true }], day, day)).toEqual([-margin]);
  });
});

describe("bestSellersIn over invoices as received (spec E1 Best sellers)", () => {
  const WINDOW = { from: "2026-08-01", to: ANCHOR, limit: 10 };
  const measures = (rows: ReturnType<typeof bestSellersIn>) =>
    rows.map((r) => ({ productId: r.productId, revenue: r.revenue, quantity: r.quantity }));

  describe.each(COMPANIES)("%s", (_, f) => {
    const stripped = invoicesAsSent(f.invoices, SALES);

    it.each<SellerMetric>(["revenue", "quantity"])(
      "keeps revenue and quantity by %s for Sales, with every margin unknown",
      (metric) => {
        const full = bestSellersIn(f.invoices, f.products, { ...WINDOW, metric });
        const seen = bestSellersIn(stripped, f.products, { ...WINDOW, metric });
        expect(full.length).toBeGreaterThan(0);
        expect(measures(seen)).toEqual(measures(full));
        expect(seen.every((r) => r.margin === null)).toBe(true);
      },
    );

    it("ranks by revenue when asked for margin it can't know", () => {
      expect(bestSellersIn(stripped, f.products, { ...WINDOW, metric: "margin" })).toEqual(
        bestSellersIn(stripped, f.products, { ...WINDOW, metric: "revenue" }),
      );
    });

    it("ranks by margin, as before, when every cost is known", () => {
      const rows = bestSellersIn(f.invoices, f.products, { ...WINDOW, metric: "margin" });
      expect(rows.length).toBeGreaterThan(1);
      rows.forEach((row, i) => {
        expect(row.margin).not.toBeNull();
        if (i > 0) expect(dec(rows[i - 1]!.margin!).gte(row.margin!)).toBe(true);
      });
    });

    it("never counts a contract invoice: its lines carry no product, so contract cost changes nothing", () => {
      const contracts = f.invoices.filter((i) => i.contractId);
      expect(contracts.length).toBeGreaterThan(0);
      expect(contracts.every((i) => i.lines.every((line) => !line.productId))).toBe(true);
      const range = { from: "2026-09-01", to: "2026-10-31", limit: 10 };
      for (const metric of ["revenue", "margin"] as const) {
        expect(bestSellersIn(invoicesAsSent(f.invoices, NO_CONTRACT_COST), f.products, { ...range, metric })).toEqual(
          bestSellersIn(f.invoices, f.products, { ...range, metric }),
        );
      }
    });
  });

  it("leaves every row's margin unknown when one counted line lacks cost, since rows rank against each other", () => {
    const base = summit.invoices.find((i) => !i.isReturn && !i.contractId)!;
    const line = (productId: string, unitPrice: string): DocLine => ({
      id: productId,
      productId,
      description: productId,
      category: "material",
      unit: "sq_ft",
      quantity: "100",
      unitPrice,
      unitCost: "1.00",
    });
    const withoutCost: ViewedDocLine = line("p-a", "5.00");
    delete withoutCost.unitCost;
    const invoice: ViewedInvoice = {
      ...base,
      issuedAt: "2026-10-01",
      voidedAt: null,
      lines: [withoutCost, line("p-b", "4.00")],
    };
    const range = { from: "2026-10-01", to: "2026-10-01", limit: 5 };
    const byRevenue = bestSellersIn([invoice], [], { ...range, metric: "revenue" });
    expect(byRevenue).toEqual([
      { productId: "p-a", revenue: "500.00", quantity: "100", margin: null },
      { productId: "p-b", revenue: "400.00", quantity: "100", margin: null },
    ]);
    expect(bestSellersIn([invoice], [], { ...range, metric: "margin" })).toEqual(byRevenue);
  });
});

describe("teamStats over invoices as received (Sales → Team, the top performer)", () => {
  const inputs = (f: CompanyFixtures, invoices: CompanyFixtures["invoices"]) => ({
    users: f.users,
    invoices,
    commission: new Map(),
    payments: f.payments,
    quotes: f.quotes,
  });

  it.each(COMPANIES)("%s: keeps every other figure for Sales and leaves margin unknown", (_, f) => {
    const range = { from: "2026-01-01", to: ANCHOR, today: ANCHOR };
    const full = teamStats(inputs(f, f.invoices), range);
    const seen = teamStats(inputs(f, invoicesAsSent(f.invoices, SALES)), range);
    const issued = (userId: string) =>
      f.invoices.some(
        (i) => i.salesRepId === userId && !i.voidedAt && i.issuedAt >= range.from && i.issuedAt <= range.to,
      );
    expect(full.some((r) => issued(r.userId))).toBe(true);
    expect(seen).toEqual(full.map((r) => ({ ...r, margin: issued(r.userId) ? null : r.margin })));
  });

  it("leaves only the margins of people with a contract invoice unknown without contract cost", () => {
    const range = { from: "2026-09-01", to: "2026-10-31", today: ANCHOR };
    const full = teamStats(inputs(summit, summit.invoices), range);
    const seen = teamStats(inputs(summit, invoicesAsSent(summit.invoices, NO_CONTRACT_COST)), range);
    const row = (rows: typeof full, userId: string) => rows.find((r) => r.userId === userId)!;
    for (const holder of ["sm-usr-08", "sm-usr-03"]) {
      expect(summit.invoices.some((i) => i.contractId && i.salesRepId === holder)).toBe(true);
      expect(row(seen, holder)).toEqual({ ...row(full, holder), margin: null });
    }
    expect(summit.invoices.some((i) => i.contractId && i.salesRepId === "sm-usr-09")).toBe(false);
    expect(row(seen, "sm-usr-09")).toEqual(row(full, "sm-usr-09"));
    expect(row(full, "sm-usr-09").margin).not.toBeNull();
  });
});

describe("sumKnown, signedCost and signedSubtotal carry the rule once (CLAUDE.md rule 5)", () => {
  it("sumKnown: an empty list is a known zero, one unknown makes the sum unknown", () => {
    expect(sumKnown([])?.toString()).toBe("0");
    expect(sumKnown([dec("1.10"), dec("2.20")])?.toString()).toBe("3.3");
    expect(sumKnown([dec("1.10"), null, dec("2.20")])).toBeNull();
  });

  it("signedCost: a return counts against, and an absent or null cost is unknown", () => {
    expect(signedCost({ isReturn: false, cost: "10.00" })?.toString()).toBe("10");
    expect(signedCost({ isReturn: true, cost: "10.00" })?.toString()).toBe("-10");
    expect(signedCost({ isReturn: false, cost: null })).toBeNull();
    expect(signedCost({ isReturn: false })).toBeNull();
  });

  it("signedSubtotal: a return counts against", () => {
    expect(signedSubtotal({ isReturn: true, subtotal: "25.50" }).toString()).toBe("-25.5");
  });

  it("takes stored invoices where invoices as received are asked for", () => {
    const received: readonly ViewedInvoice[] = summit.invoices;
    expect(received).toBe(summit.invoices);
  });
});
