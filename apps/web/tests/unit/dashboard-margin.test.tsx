import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  defaultNumberSettings,
  formatNumber,
  invoicesIn,
  last12Months,
  ledgerIndex,
  monthlyPnl,
  periodRange,
  pnlTotals,
  roleTemplate,
  SENSITIVE,
  type Invoice,
  type PermissionKey,
  type ViewedDocLine,
  type ViewedInvoice,
} from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { WorkspaceContext, type Workspace } from "@/components/workspace/workspace-context";
import { BestSellers } from "@/features/dashboard/best-sellers";
import { FigureRow } from "@/features/dashboard/dashboard-page";
import { RevenuePanel } from "@/features/dashboard/revenue-panel";
import type { DashboardData } from "@/features/dashboard/use-dashboard-data";
import { TeamTable } from "@/features/sales/team-table";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import type { SalesLedger } from "@/lib/sales-ledger";

// Today is the fixtures' anchor. Team's commission read is the only query rendered; it has no lines,
// and the table's URL state reads an empty address.
vi.mock("@/lib/api", () => ({ api: { today: () => "2026-11-04", timeZone: () => "America/Denver" } }));
vi.mock("@/lib/api/use-api", () => ({ useApiQuery: () => ({ status: "ready", data: [] }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/sales",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const ANCHOR = "2026-11-04";
const summit = await loadCompanyFixtures("summit");

/** A copy of an invoice as `GET /invoices` sends it to someone without its cost (CLAUDE.md rule 5). */
function withoutCost(invoice: Invoice): ViewedInvoice {
  const viewed: ViewedInvoice = {
    ...invoice,
    lines: invoice.lines.map((line) => {
      const seen: ViewedDocLine = { ...line };
      delete seen.unitCost;
      return seen;
    }),
  };
  delete viewed.cost;
  return viewed;
}

/** Every invoice as the API sends it to Sales, or to anyone without product cost. */
const STRIPPED = summit.invoices.map(withoutCost);
/** As the API sends them to someone with product cost but not contract cost (`contractCostShown`). */
const NO_CONTRACT_COST = summit.invoices.map((i) => (i.contractId ? withoutCost(i) : i));
/** Only Evan Shaw's invoices without cost. */
const EVAN = "sm-usr-08";
const EVAN_STRIPPED = summit.invoices.map((i) => (i.salesRepId === EVAN ? withoutCost(i) : i));

/**
 * The invoices as the web's sales ledger holds them: typed as stored invoices, though the API left
 * the cost out (B1 Q4), with every ledger worked out as `loadSalesLedger` does.
 */
function salesLedger(invoices: readonly ViewedInvoice[]): SalesLedger {
  const received = invoices as unknown as Invoice[];
  const settled = { payments: summit.payments, adjustments: summit.invoiceAdjustments };
  return {
    invoices: received,
    payments: summit.payments,
    adjustments: summit.invoiceAdjustments,
    refunds: summit.refunds,
    ledgers: ledgerIndex(received, settled, ANCHOR),
  };
}

/** What the dashboard holds besides the sales ledger and its 12-month figures. */
const RECORDS = {
  slow: [],
  jobsToday: [],
  quotes: summit.quotes,
  expenses: summit.expenses,
  products: summit.products,
  locations: summit.locations,
  users: summit.users,
  roles: summit.roles,
};

/** The dashboard's records over `invoices`, its 12-month figures from the hook's own functions. */
function dashboardData(invoices: readonly ViewedInvoice[]): DashboardData {
  const sales = salesLedger(invoices);
  const months = monthlyPnl(last12Months(ANCHOR), sales.invoices, summit.expenses);
  return { ...RECORDS, sales, months, totals: pnlTotals(months) };
}

/** The records `FigureRow` reads; it never reads the 12-month figures. */
function figureData(invoices: readonly ViewedInvoice[]): DashboardData {
  return { ...RECORDS, sales: salesLedger(invoices), months: [], totals: { revenue: "0.00", margin: null } };
}

/** The markup of `ui` for a viewer holding `held`, inside the real workspace context. */
function render(held: readonly PermissionKey[], ui: ReactNode): string {
  const workspace = { access: { permissions: new Set<PermissionKey>(held) }, user: { id: "sm-usr-01" } };
  return renderToStaticMarkup(
    <TooltipProvider>
      <WorkspaceContext.Provider value={workspace as unknown as Workspace}>{ui}</WorkspaceContext.Provider>
    </TooltipProvider>,
  );
}

/** The markup's text with the tags taken out. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

/** The figure card whose label is `label`, or undefined when there is none. */
const card = (html: string, label: string) => html.split("<div class=").find((part) => part.includes(`>${label}</dt>`));

/** The text of every column header in the markup. */
const columnHeaders = (html: string) => [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).trim());

const SALES_KEYS = roleTemplate("sales").permissions;
const MARGIN_ONLY = [SENSITIVE.margin];
const BOTH = [SENSITIVE.margin, SENSITIVE.productCost];
const LAST_30 = periodRange("30d", ANCHOR);

/** The four viewers of B1's quote test: (a) Sales, (b) both keys without cost, (c) the margin key alone, (d) both keys. */
const VIEWERS = [
  ["(a) a salesperson, whose invoices arrive without cost", SALES_KEYS, STRIPPED, false],
  ["(b) both keys while the API withheld cost (the shell grants more than the server)", BOTH, STRIPPED, false],
  [
    "(c) the margin key alone, with every cost at hand, because margin gives the cost away",
    MARGIN_ONLY,
    summit.invoices,
    false,
  ],
  ["(d) both keys with every cost known", BOTH, summit.invoices, true],
] as const;

describe("the 12-month panel's margin (spec E1; ADR 0037, 2026-11-17)", () => {
  it.each(VIEWERS)("%s", (_, held, invoices, shows) => {
    const data = dashboardData(invoices);
    const shown = text(render(held, <RevenuePanel data={data} ownScope={false} />));
    expect(shown).toContain(formatNumber(data.totals.revenue, "money", defaultNumberSettings(), { compact: true }));
    if (shows) {
      expect(shown).toContain("Revenue and gross margin, last 12 months");
      expect(shown).toContain("Gross margin");
      expect(shown).toContain("Gross profit");
      expect(shown).toContain(formatNumber(data.totals.margin!.marginPct, "percent", defaultNumberSettings()));
    } else {
      expect(shown).toContain("Revenue, last 12 months");
      expect(shown).not.toContain("Gross margin");
      expect(shown).not.toContain("Gross profit");
    }
  });
});

describe("the Gross margin card (spec E1; ADR 0037, 2026-11-17)", () => {
  it.each(VIEWERS)("%s", (_, held, invoices, shows) => {
    const html = render(held, <FigureRow data={figureData(invoices)} period={LAST_30} locationId={null} />);
    expect(card(html, "Revenue")).toBeDefined();
    expect(card(html, "Gross margin") !== undefined).toBe(shows);
  });

  it("(e) is left out over a period holding a contract invoice the viewer can't cost", () => {
    const october = periodRange("custom", ANCHOR, { from: "2026-10-01", to: "2026-10-31" });
    expect(invoicesIn(summit.invoices, october.from, october.to).some((i) => i.contractId)).toBe(true);
    const html = render(BOTH, <FigureRow data={figureData(NO_CONTRACT_COST)} period={october} locationId={null} />);
    expect(card(html, "Revenue")).toBeDefined();
    expect(card(html, "Gross margin")).toBeUndefined();
  });

  it("(f) shows, with no change line, when only the earlier period holds such an invoice", () => {
    const period = periodRange("custom", ANCHOR, { from: "2026-10-24", to: ANCHOR });
    expect(period).toMatchObject({ prevFrom: "2026-10-12", prevTo: "2026-10-23" });
    expect(invoicesIn(summit.invoices, period.from, period.to).some((i) => i.contractId)).toBe(false);
    const earlier = invoicesIn(summit.invoices, period.prevFrom, period.prevTo).filter((i) => i.contractId);
    expect(earlier.map((i) => i.number).sort()).toEqual(["INV-1222", "INV-1223"]);
    const html = render(BOTH, <FigureRow data={figureData(NO_CONTRACT_COST)} period={period} locationId={null} />);
    const margin = card(html, "Gross margin");
    expect(margin).toBeDefined();
    expect(text(margin!)).not.toContain("vs previous period");
    expect(text(margin!)).not.toContain("No earlier period to compare");
    expect(text(card(html, "Revenue")!)).toContain("vs previous period");
  });
});

describe("Best sellers' Margin option (spec E1; ADR 0037, 2026-11-17)", () => {
  it.each(VIEWERS)("%s", (_, held, invoices, shows) => {
    const html = render(held, <BestSellers invoices={invoices} products={summit.products} locationId={null} />);
    expect(html).toContain(">Revenue</button>");
    expect(html).not.toContain("No sales in this period.");
    expect(html.includes(">Margin</button>")).toBe(shows);
  });
});

describe("Sales → Team's Margin column (commissions.md Reports; ADR 0037, 2026-11-17)", () => {
  const team = (held: readonly PermissionKey[], invoices: readonly ViewedInvoice[]) =>
    columnHeaders(
      render(
        held,
        <TeamTable
          sales={salesLedger(invoices)}
          quotes={summit.quotes}
          users={summit.users}
          locations={summit.locations}
        />,
      ),
    );

  it.each(VIEWERS)("%s", (_, held, invoices, shows) => {
    const headers = team(held, invoices);
    expect(headers).toContain("Sales");
    expect(headers.includes("Margin")).toBe(shows);
  });

  it("(e) is left out when one salesperson's margin is unknown, so its total and CSV are never partial", () => {
    const month = periodRange("month", ANCHOR);
    expect(
      summit.invoices.some(
        (i) => i.salesRepId === EVAN && !i.voidedAt && i.issuedAt >= month.from && i.issuedAt <= month.to,
      ),
    ).toBe(true);
    const headers = team(BOTH, EVAN_STRIPPED);
    expect(headers).toContain("Sales");
    expect(headers).not.toContain("Margin");
  });
});
