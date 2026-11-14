import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, latestVersion, migrateAllCompanies, MIGRATIONS, openCompanyDb, openControlDb } from "../src";
import {
  addresses,
  bonuses,
  clockEntries,
  contractorPayments,
  payPeriodExclusions,
  payPeriodLines,
  payPeriods,
  employeeChecklistItems,
  employees,
  ptoRequests,
  timeEntries,
  timeOffEntries,
  timeOffPolicies,
  timesheets,
  changeOrderLines,
  changeOrders,
  contractBillingLines,
  contractBillingReleases,
  contractBillings,
  contractLines,
  contracts,
  insuranceCertificates,
  insuranceCoverages,
  lienWaivers,
  customers,
  goodsReceipts,
  invoiceLines,
  expenses,
  paymentsMade,
  recurringExpenses,
  supplierBills,
  invoices,
  journalEntries,
  paymentsReceived,
  reservations,
  quoteLines,
  quotes,
  products,
  purchaseOrders,
  rollCuts,
  rolls,
  roles,
  stockMovements,
  supplierContacts,
  suppliers,
  transfers,
  userProfiles,
} from "../src/company";
import { verifyPassword } from "better-auth/crypto";
import { account, organization, tenantDatabases, tenants, user } from "../src/control";
import { seedTestCompany } from "../src/seed";
import { loadDemoCompany, seedId } from "../src/seed/fixtures";
import { scratchDatabase } from "../src/testing";

const encryptionKey = randomBytes(32).toString("base64");
const userPassword = randomBytes(12).toString("base64url");

describe("test company seed", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];
  let tenantId = "";

  beforeAll(async () => {
    scratch.push(await scratchDatabase("seed_control"), await scratchDatabase("seed_company"));
    const options = {
      controlUrl: scratch[0].url,
      encryptionKey,
      provisioner: new NoopProvisioner(scratch[1].url),
      provider: "noop",
      userPassword,
    };
    tenantId = await seedTestCompany(options);
    await seedTestCompany(options);
  });

  afterAll(async () => {
    for (const database of scratch) await database.drop();
  });

  it("writes the company, its people and its encrypted database once, even when run twice", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      expect(await control.db.select().from(tenants)).toHaveLength(1);
      expect((await control.db.select().from(user)).length).toBe(15);
      const [database] = await control.db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId));
      expect(database.status).toBe("ready");
      expect(database.schemaVersion).toBe(latestVersion(MIGRATIONS.company));
      expect(database.encryptedUrl).not.toContain("postgres://");
      expect(decryptSecret(database.encryptedUrl, encryptionKey)).toBe(scratch[1].url);
    } finally {
      await control.close();
    }
  });

  it("gives every seeded user one password credential, and the organization is the tenant", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const credentials = await control.db.select().from(account).where(eq(account.providerId, "credential"));
      expect(credentials).toHaveLength(15);
      expect(await verifyPassword({ hash: credentials[0].password ?? "", password: userPassword })).toBe(true);
      const [org] = await control.db.select().from(organization);
      expect(org.id).toBe(tenantId);
    } finally {
      await control.close();
    }
  });

  it("seeds the company's roles with one locked Owner and a profile per user", async () => {
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      const seededRoles = await company.db.select().from(roles);
      expect(seededRoles.filter((role) => role.owner)).toHaveLength(1);
      expect(await company.db.select().from(userProfiles)).toHaveLength(15);
    } finally {
      await company.close();
    }
  });

  it("seeds the catalog and stock once, with every roll, cut, ledger line and transfer (inventory, part 1)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(await company.db.select().from(products)).toHaveLength(fixtures.products.length);
      expect(await company.db.select().from(rolls)).toHaveLength(fixtures.rolls.length);
      expect(await company.db.select().from(rollCuts)).toHaveLength(fixtures.rolls.flatMap((roll) => roll.cuts).length);
      expect(await company.db.select().from(stockMovements)).toHaveLength(fixtures.stockMovements.length);
      expect(await company.db.select().from(transfers)).toHaveLength(fixtures.transfers.length);
    } finally {
      await company.close();
    }
  });

  it("seeds the supplier directory, orders and receipts, and links products to suppliers (purchasing, part 1)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(await company.db.select().from(suppliers)).toHaveLength(fixtures.suppliers.length);
      expect(await company.db.select().from(supplierContacts)).toHaveLength(fixtures.supplierContacts.length);
      expect(await company.db.select().from(purchaseOrders)).toHaveLength(fixtures.purchaseOrders.length);
      expect(await company.db.select().from(goodsReceipts)).toHaveLength(fixtures.receipts.length);
      expect(await company.db.select().from(expenses)).toHaveLength(fixtures.expenses.length);
      expect(await company.db.select().from(recurringExpenses)).toHaveLength(fixtures.recurringExpenses.length);
      // Subcontract bills are seeded with their contract billings (ADR 0045).
      expect(await company.db.select().from(supplierBills)).toHaveLength(fixtures.bills.length);
      expect(await company.db.select().from(paymentsMade)).toHaveLength(fixtures.supplierPayments.length);
      const linked = (await company.db.select().from(products)).filter((product) => product.supplierId !== null);
      expect(linked).toHaveLength(fixtures.products.filter((product) => product.supplierId).length);
    } finally {
      await company.close();
    }
  });

  it("seeds customers with their addresses, and quotes with their lines (sales, part 1)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(await company.db.select().from(customers)).toHaveLength(fixtures.customers.length);
      expect(await company.db.select().from(addresses)).toHaveLength(
        fixtures.customers.flatMap((c) => c.addresses).length,
      );
      expect(await company.db.select().from(quotes)).toHaveLength(fixtures.quotes.length);
      expect(await company.db.select().from(quoteLines)).toHaveLength(fixtures.quotes.flatMap((q) => q.lines).length);
    } finally {
      await company.close();
    }
  });

  it("seeds invoices with their lines, payments and reservations (sales, part 2; contracts, part 2)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    // Contract billing invoices are seeded too, with their billings (ADR 0045).
    const billed = fixtures.invoices;
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(await company.db.select().from(invoices)).toHaveLength(billed.length);
      expect(await company.db.select().from(invoiceLines)).toHaveLength(billed.flatMap((i) => i.lines).length);
      expect(await company.db.select().from(paymentsReceived)).toHaveLength(fixtures.payments.length);
      expect(await company.db.select().from(reservations)).toHaveLength(fixtures.reservations.length);
      const kept = new Set(billed.map((invoice) => invoice.id));
      // Invoice lines reuse quote-line fixture ids, so their seed ids carry a prefix.
      const firstLine = billed[0]!.lines[0]!;
      const [line] = await company.db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.id, seedId(`invoice:${firstLine.id}`)));
      expect(line?.invoiceId).toBe(seedId(billed[0]!.id));
      const note = billed.find((invoice) => invoice.creditForInvoiceId)!;
      const [credited] = await company.db
        .select()
        .from(invoices)
        .where(eq(invoices.id, seedId(note.creditForInvoiceId!)));
      expect(credited).toBeDefined();
      const reviewed = fixtures.payments.find(
        (p) => p.status === "confirmed" && p.reviewedBy && kept.has(p.invoiceId),
      )!;
      const [payment] = await company.db
        .select()
        .from(paymentsReceived)
        .where(eq(paymentsReceived.id, seedId(reviewed.id)));
      expect(payment?.reviewedById).not.toBeNull();
    } finally {
      await company.close();
    }
  });

  it("seeds contracts with their lines, change orders, waivers and insurance (contracts, part 1)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(await company.db.select().from(contracts)).toHaveLength(fixtures.contracts.length);
      expect(await company.db.select().from(contractLines)).toHaveLength(fixtures.contractLines.length);
      expect(await company.db.select().from(changeOrders)).toHaveLength(fixtures.changeOrders.length);
      expect(await company.db.select().from(changeOrderLines)).toHaveLength(
        fixtures.changeOrders.flatMap((order) => order.lines).length,
      );
      // Every payment a waiver cites is seeded now, so every waiver is (ADR 0045).
      expect(await company.db.select().from(lienWaivers)).toHaveLength(fixtures.lienWaivers.length);
      expect(await company.db.select().from(insuranceCertificates)).toHaveLength(fixtures.insuranceCertificates.length);
      expect(await company.db.select().from(insuranceCoverages)).toHaveLength(
        fixtures.insuranceCertificates.flatMap((certificate) => certificate.coverages).length,
      );
      const [first] = await company.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, seedId(fixtures.contracts[0]!.id)));
      expect(first?.number).toBe(fixtures.contracts[0]!.number);
    } finally {
      await company.close();
    }
  });

  it("seeds contract billings with their lines, releases, invoices and subcontract bills (contracts, part 2)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(fixtures.contractBillings.length).toBeGreaterThan(0);
      expect(await company.db.select().from(contractBillings)).toHaveLength(fixtures.contractBillings.length);
      expect(await company.db.select().from(contractBillingLines)).toHaveLength(
        fixtures.contractBillings.flatMap((billing) => billing.lines).length,
      );
      expect(await company.db.select().from(contractBillingReleases)).toHaveLength(
        fixtures.contractBillings.flatMap((billing) => billing.releases).length,
      );
      // Each billing points at the invoice or bill it raised, and that document points back.
      for (const billing of fixtures.contractBillings) {
        const [row] = await company.db
          .select()
          .from(contractBillings)
          .where(eq(contractBillings.id, seedId(billing.id)));
        expect(row?.invoiceId).toBe(billing.invoiceId ? seedId(billing.invoiceId) : null);
        expect(row?.billId).toBe(billing.billId ? seedId(billing.billId) : null);
      }
      const contractInvoices = await company.db.select().from(invoices).where(isNotNull(invoices.billingId));
      expect(contractInvoices).toHaveLength(fixtures.invoices.filter((invoice) => invoice.billingId).length);
      const fixture = fixtures.invoices.find((invoice) => invoice.billingId)!;
      const [seeded] = await company.db
        .select()
        .from(invoices)
        .where(eq(invoices.id, seedId(fixture.id)));
      expect(seeded).toMatchObject({
        contractId: seedId(fixture.contractId!),
        billingId: seedId(fixture.billingId!),
        retainageWithheld: fixture.retainageWithheld,
        total: fixture.total,
      });
      const subcontractBills = await company.db.select().from(supplierBills).where(isNotNull(supplierBills.billingId));
      expect(subcontractBills).toHaveLength(fixtures.bills.filter((bill) => bill.billingId).length);
      // Seeded history posts nothing: the ledger starts at go-live.
      expect(await company.db.select().from(journalEntries)).toHaveLength(0);
    } finally {
      await company.close();
    }
  });

  it("seeds people, timesheets and time off once, and links sign-ins to employees (HR, part 1)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      expect(await company.db.select().from(employees)).toHaveLength(fixtures.employees.length);
      expect(await company.db.select().from(employeeChecklistItems)).toHaveLength(
        fixtures.employees.flatMap((e) => [...e.onboarding, ...e.offboarding]).length,
      );
      expect(await company.db.select().from(timesheets)).toHaveLength(fixtures.timesheets.length);
      expect(await company.db.select().from(timeEntries)).toHaveLength(fixtures.timesheets.length * 7);
      expect(await company.db.select().from(clockEntries)).toHaveLength(fixtures.clockEntries.length);
      expect(await company.db.select().from(timeOffPolicies)).toHaveLength(fixtures.timeOffPolicies.length);
      expect(await company.db.select().from(ptoRequests)).toHaveLength(fixtures.ptoRequests.length);
      const ledger = await company.db.select().from(timeOffEntries);
      expect(ledger).toHaveLength(fixtures.timeOffEntries.length);
      // Accrual lines point at the pay period that posted them (HR part 2; ADR 0047).
      expect(ledger.filter((entry) => entry.payPeriodId !== null)).toHaveLength(
        fixtures.timeOffEntries.filter((entry) => entry.payPeriodId).length,
      );
      expect(ledger.filter((entry) => entry.payPeriodId !== null)).toHaveLength(54);
      const linked = (await company.db.select().from(userProfiles)).filter((profile) => profile.employeeId);
      expect(linked).toHaveLength(fixtures.users.filter((person) => person.employeeId).length);
      const fixture = fixtures.employees.find((e) => e.managerId)!;
      const [row] = await company.db
        .select()
        .from(employees)
        .where(eq(employees.id, seedId(fixture.id)));
      expect(row).toMatchObject({ managerId: seedId(fixture.managerId!), payRate: fixture.payRate });
      // No Social Security or bank columns exist on the table (CLAUDE.md rule 14).
      expect(Object.keys(row!).some((key) => /ssn|social|bank|routing|account/i.test(key))).toBe(false);
    } finally {
      await company.close();
    }
  });

  it("seeds pay periods, their lines, bonuses and contractor payments, with no journal entries (HR, part 2)", async () => {
    const { fixtures } = loadDemoCompany("summit");
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      const periods = await company.db.select().from(payPeriods);
      expect(periods).toHaveLength(fixtures.payPeriods.length);
      expect(periods.filter((period) => period.status === "exported").every((period) => period.approvedById)).toBe(
        true,
      );
      expect(await company.db.select().from(payPeriodExclusions)).toHaveLength(
        fixtures.payPeriods.flatMap((period) => period.excluded).length,
      );
      const lines = await company.db.select().from(payPeriodLines);
      expect(lines).toHaveLength(fixtures.payPeriods.flatMap((period) => period.lines).length);
      expect(await company.db.select().from(bonuses)).toHaveLength(fixtures.bonuses.length);
      expect(await company.db.select().from(contractorPayments)).toHaveLength(fixtures.contractorPayments.length);
      // Seeded history posts nothing: the ledger starts at go-live.
      const entries = await company.db.select().from(journalEntries);
      expect(entries.filter((entry) => ["pay_period", "contractor_payment"].includes(entry.sourceType))).toEqual([]);
    } finally {
      await company.close();
    }
  });

  it("migrate-all brings every company to the newest version", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      expect(await migrateAllCompanies(control.db, encryptionKey)).toEqual([
        { tenantId, version: latestVersion(MIGRATIONS.company) },
      ]);
    } finally {
      await control.close();
    }
  });
});
