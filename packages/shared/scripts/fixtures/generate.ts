import { last12Months } from "../../src/dates";
import { dec, moneyString, sum } from "../../src/money";
import { monthlyPnl } from "../../src/analytics";
import type { CompanyFixtures, PlatformFixtures, Supplier } from "../../src/types";
import { buildAudit } from "./audit";
import { buildProducts, buildSuppliers } from "./catalog";
import { ANCHOR_DATE, COMPANY_SEEDS, type CompanySeed } from "./companies";
import { GenContext } from "./context";
import { buildCustomers, withJobSites } from "./customers";
import { buildEmployees, buildPto, buildTimesheets } from "./hr";
import { withContracts } from "./contracts";
import { withHrRecords } from "./hr-records";
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
  const months = monthlyPnl(last12Months(anchor), fixtures.invoices, []);
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
    audit: buildAudit(ctx, users),
    importBatches: [],
    importMappings: [],
    notificationRules: [],
    outboxMessages: [],
    inAppNotifications: [],
  });
  return withHrRecords(ctx, withContracts(ctx, withDirectory(ctx, withBuyer(ctx, fixtures))));
}

/** Generates all demo fixtures from fixed seeds (CLAUDE.md rule 5). */
export function generateFixtures(): GeneratedFixtures {
  return {
    platform: { anchorDate: ANCHOR_DATE, companies: COMPANY_SEEDS.map(buildCompany) },
    companies: COMPANY_SEEDS.map(generateCompany),
  };
}
