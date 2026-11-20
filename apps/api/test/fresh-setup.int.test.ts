import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { branches, settings } from "@workspace/db/company";
import { adminUrl } from "@workspace/db/testing";
import { companyDatabaseName, PostgresServerProvisioner } from "@workspace/providers";
import {
  API_LOCALIZATION_TABS,
  API_SETTINGS_SECTIONS,
  boxedOnHand,
  dec,
  numbersToWire,
  planActions,
  type Bill,
  type CompanyAnswer,
  type CompanySettings,
  type Customer,
  type GoodsReceipt,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
  type Invoice,
  type Location,
  type Payment,
  type Product,
  type PurchaseOrder,
  type StockMovement,
  type Supplier,
} from "@workspace/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "./support/company-day";
import { AuthHarness } from "./auth-harness";
import { localizationRow, SUMMIT_SETTINGS } from "./support/company-bootstrap";
import { NAME_REUSED_AT } from "./support/json-walk";
import { sampleImport } from "./support/fresh-csv";
import { freshCalls } from "./support/fresh-calls";
import { acceptInvitation, inviteProvisionedOwner, provisionedOwner } from "./support/fresh-owner";
import { balanceOf, trialBalanceProblems, unbalancedEntries, type TrialBalance } from "./support/ledger-read";
import { MoneyApi, moneyCalls, refusalOf, type Call } from "./support/money-actions";
import type { Hold } from "./support/money-model";
import { enrolled, stepUp, type EnrolledPerson } from "./support/sign-in";

/**
 * The whole-product check's fresh company (FS): a company made by the setup script the owner runs
 * (`pnpm db:provision-tenant`, packages/db/scripts/provision-tenant.ts), then set up only through
 * the API as its screens would: its settings, its locations, and invented sample CSV files of
 * suppliers, products, customers and addresses through the import. It then buys, sells and gets
 * paid, and the books must agree with the documents. Where the product has no way yet (G2: no
 * settings at provisioning, so no Localization tab can be saved; G3: no branch route; G4: no Owner
 * invitation at provisioning), the test pins the refusal, steps in once with what provisioning or
 * the missing route would write, and says so.
 */

const harness = new AuthHarness();
const api = new MoneyApi(harness);

/** The packages/db folder the setup script runs in, as `pnpm db:provision-tenant` runs it. */
const DB_PACKAGE = fileURLToPath(new URL("../../../packages/db/", import.meta.url));
/** The invented company: its name, place and zone (the zone also the region tab's, read only). */
const COMPANY = {
  name: "Juniper Ridge Test Floors",
  legalName: "Juniper Ridge Test Floors LLC",
  state: "CO",
  city: "Boulder",
  zone: "America/Denver",
  ownerName: "Rowan Ellis",
} as const;
const slug = `fsjr${process.pid}${randomBytes(2).toString("hex")}`;
const ownerEmail = `rowan.ellis.${slug}@example.test`;

beforeAll(async () => {
  await harness.start();
}, 120_000);

afterAll(async () => {
  // The script provisioned outside the harness's own list, so its database is dropped here.
  await new PostgresServerProvisioner(adminUrl).drop(companyDatabaseName(slug));
  await harness.stop();
}, 120_000);

describe("a fresh company from the setup script, set up through the API with sample CSV data (whole-product check FS; needs the local PostgreSQL)", () => {
  let companyId = "";
  let owner: EnrolledPerson;
  let warehouseId = "";
  const today = todayIn(COMPANY.zone);

  const ok = <T>(status: number, call: Call) => api.expect<T>(status, call, owner.cookie);
  const read = <T>(path: string) => api.read<T>(path, owner.cookie);
  const put = (path: string, body: object): Call => ({ verb: "put", path, body });
  /** An answer's status with its refusal's code and words (docs/api-contract.md, ErrorBody). */
  const answerTo = async (call: Call) => {
    const answer = await api.send(call, owner.cookie);
    return { status: answer.status, ...refusalOf(answer) };
  };

  /** Checks a sample file, steps up and imports it with the dry run's actions, as the Import screen does. */
  async function importSample(kind: ImportKind, fileName: string): Promise<ImportResult> {
    const file = sampleImport(kind, fileName);
    const preview = await ok<ImportPreview>(200, freshCalls.importCheck(file));
    expect(
      preview.rows.flatMap((row) => row.problems.map((problem) => `${fileName} line ${row.line}: ${problem.message}`)),
    ).toEqual([]);
    await stepUp(harness, owner);
    return ok<ImportResult>(201, freshCalls.importCommit(file, planActions(preview.rows)));
  }

  it("FS-1: the setup script makes the company, its own database and an Owner with no password", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/provision-tenant.ts",
        ...["--slug", slug, "--name", COMPANY.name, "--legal-name", COMPANY.legalName],
        ...["--state", COMPANY.state, "--city", COMPANY.city, "--time-zone", COMPANY.zone],
        ...["--products", "flooring", "--owner-name", COMPANY.ownerName, "--owner-email", ownerEmail],
      ],
      {
        cwd: DB_PACKAGE,
        // The harness's control database and key, which the API under test reads; the local server.
        env: { ...process.env, TENANT_DB_ADMIN_URL: adminUrl, DB_PROVIDER: "postgres" },
        timeout: 90_000,
      },
    );
    const created = /^Created company (\S+) \(tenant ([0-9a-f-]{36})\)\.$/m.exec(stdout);
    expect(created?.[1]).toBe(slug);
    companyId = created?.[2] ?? "";
    expect(stdout).toContain("has no password yet");
    expect(await provisionedOwner(harness, companyId)).toMatchObject({ email: ownerEmail });
  }, 120_000);

  it("FS-2, GAP-G4: the Owner, invited in place of the invitation provisioning doesn't send, signs in with MFA and sees an empty company", async () => {
    const invitation = await inviteProvisionedOwner(harness, companyId);
    await acceptInvitation(harness, invitation.token);
    owner = await enrolled(harness, invitation.email);
    expect(await read("/auth/context")).toMatchObject({ company: { id: companyId, slug, name: COMPANY.name } });
    const company = await read<CompanyAnswer>("/company");
    expect(company.company.branches).toEqual([]);
    for (const path of ["/locations", "/products", "/customers", "/suppliers", "/invoices"]) {
      expect(await read(path), path).toEqual([]);
    }
  }, 60_000);

  it("FS-3, GAP-G2: no Localization tab saves on a company that has none; with the row written in place of provisioning, every tab and section saves through the API, the bank account too, and a customer can be added by hand", async () => {
    // The screens start from the defaults Reset to default reads (ADR 0059 D7); this company
    // keeps them but for its own name and address.
    const mine: CompanySettings = {
      ...SUMMIT_SETTINGS,
      profile: {
        ...SUMMIT_SETTINGS.profile,
        legalName: COMPANY.legalName,
        dba: COMPANY.name,
        phone: "(303) 555-0114",
        email: `office.${slug}@example.test`,
        website: "",
        address: { street: "2600 Pearl St", city: COMPANY.city, state: COMPANY.state, zip: "80302", county: "Boulder" },
      },
      branding: { ...SUMMIT_SETTINGS.branding, displayName: COMPANY.name, monogram: "JR" },
    };
    await stepUp(harness, owner);
    // G2: nothing is invented, so a company provisioned without settings can't save any tab
    // (ADR 0059 part 2a D7, part 2b D11; STATUS "Settings at provisioning").
    for (const tab of API_LOCALIZATION_TABS) {
      expect(await answerTo(put(`/settings/localization/${tab}`, mine.localization[tab])), tab).toEqual({
        status: 409,
        code: "settings_missing",
        message:
          "Settings → Localization and tax isn't set up for this company yet, so one tab can't be saved on its own.",
      });
    }
    expect(await answerTo(moneyCalls.customer("Walk-in Counter Sale"))).toEqual({
      status: 409,
      code: "settings_missing",
      message: "Finish Settings → Localization and tax before creating quotes.",
    });
    // The only stand-in for settings: the Localization row seeding at provisioning would write.
    const handle = await harness.companyDb(companyId);
    try {
      await handle.db.insert(settings).values(localizationRow(COMPANY.zone));
    } finally {
      await handle.close();
    }
    for (const tab of API_LOCALIZATION_TABS) {
      await ok(200, put(`/settings/localization/${tab}`, mine.localization[tab]));
    }
    for (const section of API_SETTINGS_SECTIONS) {
      await ok(200, put(`/settings/${section}`, section === "numbers" ? numbersToWire(mine.numbers) : mine[section]));
    }
    await ok(
      200,
      moneyCalls.accounting({
        costingMethod: "average",
        salesTaxBasis: "accrual",
        bankAccounts: [{ name: "Operating", methods: ["check", "ach", "card"] }],
      }),
    );
    const saved = await read<Partial<CompanySettings>>("/settings");
    expect(saved.profile).toEqual(mine.profile);
    expect(saved.payments).toEqual(mine.payments);
    expect(saved.localization?.region).toEqual(mine.localization.region);
    // F-n: with Localization saved, a customer by hand is taken.
    await ok<Customer>(201, moneyCalls.customer("Walk-in Counter Sale"));
  }, 60_000);

  it("FS-4, GAP-G3: a location waits for a branch no route adds; with one branch written in its place, a warehouse and a showroom save through the API", async () => {
    const location = (name: string, kind: "warehouse" | "showroom", branchId: string, isDefault: boolean) => ({
      name,
      kind,
      branchId,
      address: { street: "4100 Arapahoe Ave", city: COMPANY.city, state: COMPANY.state, zip: "80303" },
      isDefault,
      displaySamples: 0,
    });
    // The only stand-in: one branch row, as the demo seed writes branches (FA-5 pins the gap).
    const handle = await harness.companyDb(companyId);
    let branchId = "";
    try {
      const [branch] = await handle.db
        .insert(branches)
        .values({ name: COMPANY.city, city: COMPANY.city, state: COMPANY.state })
        .returning();
      branchId = branch?.id ?? "";
    } finally {
      await handle.close();
    }
    const warehouse = await ok<Location>(201, {
      verb: "post",
      path: "/locations",
      body: location("Boulder warehouse", "warehouse", branchId, true),
    });
    warehouseId = warehouse.id;
    await ok<Location>(201, {
      verb: "post",
      path: "/locations",
      body: location("Pearl Street showroom", "showroom", branchId, false),
    });
    const listed = await read<Location[]>("/locations");
    expect(listed.map((l) => [l.name, l.kind, l.branchId]).sort()).toEqual([
      ["Boulder warehouse", "warehouse", branchId],
      ["Pearl Street showroom", "showroom", branchId],
    ]);
  }, 60_000);

  it("FS-5 (demo step 14): the sample suppliers, products, customers and addresses import from CSV, each after a dry run and a step-up, and the books don't move", async () => {
    const before = await api.trialBalance(owner.cookie);
    const counts = async (kind: ImportKind, fileName: string) => (await importSample(kind, fileName)).batch.counts;
    expect(await counts("suppliers", "suppliers.csv")).toEqual({ create: 3, update: 0, skip: 0, error: 0 });
    expect(await counts("products", "products.csv")).toEqual({ create: 3, update: 0, skip: 0, error: 0 });
    expect(await counts("customers", "customers.csv")).toEqual({ create: 3, update: 0, skip: 0, error: 0 });
    // Harlow's job site is the street and ZIP the customers file gave, so that row updates it.
    expect(await counts("addresses", "addresses.csv")).toEqual({ create: 2, update: 1, skip: 0, error: 0 });

    const suppliers = await read<Supplier[]>("/suppliers");
    expect(suppliers.map((s) => [s.name, s.type, s.terms]).sort()).toEqual([
      ["Front Gate Hauling", "services", "net_30"],
      ["Loomfield Carpet Mills", "goods", "net_60"],
      ["Quarry Lane Tile Supply", "goods", "net_30"],
    ]);
    const products = await read<Product[]>("/products");
    expect(products.map((p) => [p.sku, p.category, p.price, p.cost, p.sqFtPerCarton ?? null]).sort()).toEqual([
      ["JRT-CP-12", "carpet", "3.2500", "1.4000", null],
      ["JRT-TL-1224", "porcelain_tile", "4.9900", "2.1000", "16.000"],
      ["JRT-TL-2424", "porcelain_tile", "6.4900", "2.8000", "15.500"],
    ]);
    const customers = await read<Customer[]>("/customers");
    expect(
      customers
        .map((c) => [c.name, c.terms, c.addresses.length])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["Harlow Residence", "due_on_receipt", 1],
      ["Pinewood Builders", "net_30", 3],
      ["Vance, Tamsin", "due_on_receipt", 0],
      ["Walk-in Counter Sale", "due_on_receipt", 0],
    ]);
    expect(await api.trialBalance(owner.cookie), "an import posts nothing (ADR 0057 §2)").toEqual(before);
  }, 120_000);

  it("FS-6 (demo steps 2, 3, 5 and 7): imported tile is bought, received and billed, then quoted, invoiced, issued and paid, and the ledger agrees with the documents", async () => {
    const products = await read<Product[]>("/products");
    const tile = products.find((p) => p.sku === "JRT-TL-1224")!;
    const supplier = (await read<Supplier[]>("/suppliers")).find((s) => s.name === "Quarry Lane Tile Supply")!;
    const customer = (await read<Customer[]>("/customers")).find((c) => c.name === "Harlow Residence")!;

    // Buy 20 cartons (320 sq ft) at the imported cost, receive them all, and enter the bill at value.
    const order = await ok<PurchaseOrder>(
      201,
      moneyCalls.purchaseOrder(
        supplier.id,
        warehouseId,
        [{ productId: tile.id, description: tile.name, quantity: "320", unitCost: tile.cost }],
        false,
      ),
    );
    await ok<GoodsReceipt>(
      201,
      moneyCalls.receipt(order.id, [
        { poLineId: order.lines[0]!.id, productId: tile.id, received: "320", damaged: "0", rolls: [] },
      ]),
    );
    const received = dec("320").times(tile.cost);
    await ok<Bill>(201, moneyCalls.bill(order.id, received.toFixed(2), today));

    // Sell 5 cartons (80 sq ft) at the imported price with the company's waste for tile.
    const quote = await ok<{ id: string }>(
      201,
      moneyCalls.quote(customer.id, warehouseId, [
        {
          productId: tile.id,
          description: tile.name,
          category: "material",
          unit: "sq_ft",
          quantity: "80",
          unitPrice: tile.price,
          wastePct: SUMMIT_SETTINGS.localization.documents.defaultWastePct.porcelain_tile,
        },
      ]),
    );
    await ok(201, moneyCalls.quoteStatus(quote.id, "send"));
    await ok(201, moneyCalls.quoteStatus(quote.id, "accept"));
    const invoice = await ok<Invoice>(201, moneyCalls.invoiceFromQuote(quote.id));
    const payment = await ok<Payment>(201, moneyCalls.payment(invoice.id, invoice.total, "check", today));
    expect(payment.status, "under the saved approval threshold, the Owner's payment counts at once").toBe("confirmed");
    // Stock leaves once a payment is confirmed (inventory rule 16: "Record the deposit first").
    const hold = (await read<Hold[]>("/stock-holds")).find((candidate) => candidate.invoiceId === invoice.id)!;
    await ok(201, moneyCalls.issue(hold.reservationId));

    const trial: TrialBalance = await api.trialBalance(owner.cookie);
    expect(trialBalanceProblems(trial)).toEqual([]);
    const handle = await harness.companyDb(companyId);
    try {
      expect(await unbalancedEntries(handle.db)).toEqual([]);
    } finally {
      await handle.close();
    }
    const movements = await read<StockMovement[]>("/stock-movements");
    const onHand = boxedOnHand(movements, tile.id, warehouseId);
    const issuedCost = dec(hold.quantity).times(tile.cost);
    const bank = trial.rows.find((row) => row.key?.startsWith("bank:"))?.key ?? "bank:?";
    const money = (value: ReturnType<typeof dec>) => value.toFixed(2);
    expect({
      onHand: onHand.toString(),
      stockValue: money(onHand.times(tile.cost)),
      inventory: money(balanceOf(trial, "inventory")),
      receivedNotBilled: money(balanceOf(trial, "received_not_billed")),
      payable: money(balanceOf(trial, "accounts_payable")),
      receivable: money(balanceOf(trial, "accounts_receivable")),
      sales: money(balanceOf(trial, "sales")),
      salesTax: money(balanceOf(trial, "sales_tax_payable")),
      costOfGoods: money(balanceOf(trial, "cost_of_goods_sold")),
      bank: money(balanceOf(trial, bank)),
    }).toEqual({
      onHand: dec("320").minus(hold.quantity).toString(),
      stockValue: money(received.minus(issuedCost)),
      inventory: money(received.minus(issuedCost)),
      receivedNotBilled: "0.00",
      payable: money(received.negated()),
      receivable: "0.00",
      sales: money(dec(invoice.subtotal).negated()),
      salesTax: money(dec(invoice.tax).negated()),
      costOfGoods: money(issuedCost),
      bank: money(dec(invoice.total)),
    });
    expect(dec(invoice.tax).gt(0), "the saved Colorado rules tax the tile").toBe(true);
    expect(api.decimalIssues, "every answer's money is a decimal string (CLAUDE.md rule 6)").toEqual([]);
    const unmet = Object.keys(NAME_REUSED_AT).filter(
      (place) => !place.startsWith("GET ") && !api.reusedSeen.has(place),
    );
    expect(unmet, "no answer holds it any more: remove it from NAME_REUSED_AT").toEqual([]);
  }, 120_000);
});
