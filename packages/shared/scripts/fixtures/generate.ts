import { last12Months } from "../../src/dates";
import { dec, moneyString, sum } from "../../src/money";
import { monthlyPnl, storedPnl } from "../../src/analytics";
import type { CompanyFixtures, PlatformFixtures, Supplier } from "../../src/types";
import { buildAudit } from "./audit";
import { buildProducts, buildSuppliers } from "./catalog";
import { ANCHOR_DATE, COMPANY_SEEDS, type CompanySeed } from "./companies";
import { GenContext } from "./context";
import { buildCustomers, withJobSites } from "./customers";
import { buildEmployees, buildPto, buildTimesheets } from "./hr";
import { withContracts } from "./contracts";
import { withExpenseRecords } from "./expense-records";
import { withFinalTouches } from "./final-touches";
import { withHrRecords } from "./hr-records";
import { withMeetingRecords } from "./meeting-records";
import { buildCrews, buildJobs, holdUntilInstalled } from "./installation";
import { withExtras } from "./extras";
import { buildReservations } from "./reservations";
import { buildMeetings } from "./meetings";
import { buildExpenses, buildPurchasing } from "./purchasing";
import { buildLocations } from "./locations";
import { buildRolls } from "./rolls";
import { buildStock } from "./stock";
import { buildSales } from "./sales";
import { buildCompany, buildRoles, buildSettings, buildUsers, withBuyer } from "./tenant";
import { withDirectory } from "./directory";

/** Everything `pnpm fixtures` writes: the platform file and one file per company. */
export interface GeneratedFixtures {
  platform: PlatformFixtures;
  companies: CompanyFixtures[];
}

/** Average monthly gross margin over the trailing year, used to size operating expenses. */
function averageMonthlyGross(fixtures: Pick<CompanyFixtures, "invoices">, anchor: string): string {
  const months = storedPnl(monthlyPnl(last12Months(anchor), fixtures.invoices, []));
  return moneyString(sum(months.map((m) => m.grossMargin)).dividedBy(months.length));
}

/** Generates one company's fixtures. Builders run in a fixed order so the seed fully determines the output. */
function generateCompany(seed: CompanySeed): CompanyFixtures {
  const ctx = new GenContext(seed, ANCHOR_DATE);
  const trades = seed.sales !== null;
  const settings = buildSettings(ctx);
  const roles = buildRoles(seed);
  const employees = buildEmployees(ctx);
  const users = buildUsers(ctx, employees);
  const suppliers = (trades ? buildSuppliers(ctx) : []) as unknown as Supplier[];
  const generated = trades ? buildProducts(ctx, suppliers) : [];
  const builtRolls = trades ? buildRolls(ctx, generated, users) : [];
  const locations = buildLocations(seed.id);
  const { products, rolls, stockMovements, transfers } = buildStock(ctx, generated, builtRolls, locations, users);
  const baseCustomers = trades ? buildCustomers(ctx, users) : [];
  const sales = buildSales(ctx, { products, customers: baseCustomers, users, settings });
  const customers = withJobSites(baseCustomers, sales.quotes);
  const purchasing = buildPurchasing(ctx, suppliers, products, users);
  const installers = users.filter((u) => u.roleIds.some((r) => r.endsWith("-role-installer"))).map((u) => u.name);
  const crews = buildCrews(ctx, installers);
  const fixtures = withExtras(ctx, {
    companyId: seed.id,
    anchorDate: ANCHOR_DATE,
    settings,
    roles,
    users,
    locations,
    products,
    rolls,
    stockMovements,
    transfers,
    reservations: buildReservations(() => ctx.id("res"), ANCHOR_DATE, sales.invoices, sales.payments, products, {
      rolls,
      movements: stockMovements,
    }),
    stockAdjustments: [],
    customers,
    ...sales,
    suppliers,
    supplierContacts: [],
    ...purchasing,
    recurringExpenses: [],
    expenses: buildExpenses(ctx, trades ? averageMonthlyGross(sales, ANCHOR_DATE) : dec(0).toFixed(2)),
    crews,
    jobs: holdUntilInstalled(buildJobs(ctx, crews, sales.invoices, sales.quotes, customers), sales.invoices, customers),
    contracts: [],
    contractLines: [],
    changeOrders: [],
    contractBillings: [],
    lienWaivers: [],
    insuranceCertificates: [],
    employees,
    timesheets: buildTimesheets(ctx, employees),
    ptoRequests: buildPto(ctx, employees),
    timeOffPolicies: [],
    timeOffEntries: [],
    clockEntries: [],
    payPeriods: [],
    bonuses: [],
    contractorPayments: [],
    commissionPlans: [],
    commissionAssignments: [],
    commissionStatements: [],
    commissionAdjustments: [],
    meetings: buildMeetings(ctx, users, customers, suppliers),
    meetingResponses: [],
    customerContacts: [],
    audit: buildAudit(ctx, users),
    importBatches: [],
    importMappings: [],
    notificationRules: [],
    outboxMessages: [],
    inAppNotifications: [],
  });
  const seeded = withSoldAt(
    withExpenseRecords(
      ctx,
      withMeetingRecords(ctx, withHrRecords(ctx, withContracts(ctx, withDirectory(ctx, withBuyer(ctx, fixtures))))),
    ),
  );
  return withFinalTouches(ctx, seeded);
}

/**
 * Where each sale happened (ADR 0023), drawing no random numbers: homeowners buy at their branch's
 * showroom when it has one, dealers and contractors from the warehouse.
 */
function withSoldAt(f: CompanyFixtures): CompanyFixtures {
  const showrooms = f.locations.filter((l) => l.kind === "showroom");
  const warehouses = f.locations.filter((l) => l.kind === "warehouse");
  /** About a third of sales go to the other location, by a rule on the record's own id (audit U-29). */
  const pick = <T>(list: readonly T[], id: string, fallback: T): T => {
    if (list.length === 0) return fallback;
    const n = Number(id.replace(/\D/g, "").slice(-4)) || 0;
    return list[n % 3 === 0 ? list.length - 1 : 0]!;
  };
  const site = (doc: { id: string; customerId: string; locationId: string }) => {
    const homeowner = f.customers.find((c) => c.id === doc.customerId)?.type === "homeowner";
    if (homeowner && showrooms.length > 0) return pick(showrooms, doc.id, showrooms[0]!).id;
    const place = pick(warehouses, doc.id, { id: doc.locationId } as (typeof warehouses)[number]);
    return place.id;
  };
  return {
    ...f,
    quotes: f.quotes.map((q) => ({ ...q, soldAtLocationId: site(q) })),
    invoices: f.invoices.map((i) => ({ ...i, soldAtLocationId: site(i) })),
  };
}

/** Generates all demo fixtures from fixed seeds (CLAUDE.md rule 5). */
export function generateFixtures(): GeneratedFixtures {
  return {
    platform: { anchorDate: ANCHOR_DATE, companies: COMPANY_SEEDS.map(buildCompany) },
    companies: COMPANY_SEEDS.map(generateCompany),
  };
}
