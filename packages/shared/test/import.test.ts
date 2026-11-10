import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  autoMap,
  boxedOnHand,
  dryRunSummary,
  errorTable,
  IMPORT_HANDLERS,
  importKind,
  importKindsFor,
  mappingProblems,
  planImport,
  readCell,
  templateTable,
  type CompanyFixtures,
  type ImportField,
  type ImportKind,
  type ImportWorld,
  type PlanContext,
} from "../src";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;

const world = (): ImportWorld => ({
  customers: summit.customers,
  suppliers: summit.suppliers,
  supplierContacts: summit.supplierContacts,
  products: summit.products,
  rolls: summit.rolls,
  stockMovements: summit.stockMovements,
  invoices: summit.invoices,
  bills: summit.bills,
  employees: summit.employees,
  timesheets: summit.timesheets,
  timeOffEntries: summit.timeOffEntries,
  timeOffPolicies: summit.timeOffPolicies,
  locations: summit.locations,
  users: summit.users,
  payments: summit.payments,
  invoiceAdjustments: summit.invoiceAdjustments,
  supplierPayments: summit.supplierPayments,
  reservations: summit.reservations,
});

function context(): PlanContext {
  let n = 0;
  return {
    world: world(),
    companyId: "summit",
    today: summit.anchorDate,
    now: `${summit.anchorDate}T10:00`,
    actorId: summit.users[0]!.id,
    workweekStartDay: 1,
    batch: { id: "imp-1", number: "IMP-0001" },
    newId: (kind) => `t-${kind}-${++n}`,
  };
}

/** Plans a file given as rows of cells under the template's own headers. */
function plan(kind: ImportKind, rows: Record<string, string>[], ctx = context()) {
  const def = importKind(kind);
  const headers = def.fields.map((f) => f.label);
  const table = { headers, rows: rows.map((r) => def.fields.map((f) => r[f.key] ?? "")) };
  const mapping = autoMap(def, headers);
  return planImport(IMPORT_HANDLERS[kind], { kind, fileName: "test.csv", table, mapping }, ctx);
}

const field = (type: ImportField["type"], extra: Partial<ImportField> = {}): ImportField => ({
  key: "f",
  label: "Field",
  type,
  examples: ["", ""],
  ...extra,
});

describe("reading cells (spec G1 validate)", () => {
  it("reads money with a dollar sign and commas, and refuses three decimals or words", () => {
    expect(readCell(field("money"), "$1,250.5")).toEqual({ value: "1250.50" });
    expect(readCell(field("money"), "12.345")).toHaveProperty("error");
    expect(readCell(field("money"), "about 40")).toHaveProperty("error");
  });

  it("reads numbers with their own unit and refuses another unit", () => {
    const ft = field("number", { unit: "ft" });
    expect(readCell(ft, "120 ft")).toEqual({ value: "120" });
    expect(readCell(ft, "12'")).toEqual({ value: "12" });
    expect(readCell(ft, "36 m")).toEqual({ error: "Write “36 m” in ft, like 12 ft." });
    expect(readCell(field("integer"), "3.5")).toHaveProperty("error");
  });

  it("reads ISO and US dates and refuses impossible ones", () => {
    expect(readCell(field("date"), "3/15/2026")).toEqual({ value: "2026-03-15" });
    expect(readCell(field("date"), "2026-02-30")).toHaveProperty("error");
  });

  it("matches choices by label or value, and names the choices when it cannot", () => {
    const choice = field("choice", { choices: { job_site: "Job site", billing: "Billing" } });
    expect(readCell(choice, "JOB-SITE")).toEqual({ value: "job_site" });
    expect(readCell(choice, "Garage")).toEqual({ error: "Unknown field “Garage”. Use one of: Job site, Billing." });
    expect(readCell(field("list", { choices: { a: "Alpha", b: "Beta" } }), "alpha; Beta")).toEqual({
      value: ["a", "b"],
    });
  });

  it("requires required cells and reads yes or no", () => {
    expect(readCell(field("text", { required: true }), "  ")).toEqual({ error: "Field is required." });
    expect(readCell(field("bool"), "Y")).toEqual({ value: true });
    expect(readCell(field("email"), "Sam@Example.COM")).toEqual({ value: "sam@example.com" });
  });
});

describe("mapping columns (spec G1 step 4)", () => {
  const def = importKind("customers");

  it("matches headers by label, key and alias, each header once", () => {
    const mapping = autoMap(def, ["Customer Name", "E-mail", "Account Number", "Zip Code"]);
    expect(mapping).toMatchObject({
      name: "Customer Name",
      email: "E-mail",
      external_id: "Account Number",
      zip: "Zip Code",
    });
    expect(mapping.phone).toBeNull();
  });

  it("prefers a saved mapping when its header is in the file", () => {
    expect(autoMap(def, ["Client", "Name"], { name: "Client" }).name).toBe("Client");
  });

  it("names required fields without a column and a column chosen twice", () => {
    expect(mappingProblems(def, { name: null })).toEqual(["Choose the column for Name."]);
    expect(mappingProblems(def, { name: "A", contact_name: "A" })).toEqual([
      "“A” is chosen for both Name and Contact.",
    ]);
  });
});

describe("planning an import (spec G1 steps 5 and 6)", () => {
  it("creates customers, updates one matched by email, and reports a bad row per cell", () => {
    const known = summit.customers[0]!;
    const result = plan("customers", [
      {
        external_id: "CUST-9001",
        name: "Maple Row Builders",
        type: "Contractor",
        email: "orders@maplerow.example",
        terms: "Net 30",
        street: "12 Elm Street",
        city: "Denver",
        state: "CO",
        zip: "80216",
      },
      { name: known.name, email: known.email, phone: "(303) 555-0100" },
      { name: "Bad Row", email: "not-an-email", credit_limit: "lots" },
    ]);
    expect(result.counts).toEqual({ create: 1, update: 1, skip: 0, error: 1 });
    const created = result.changes.find((c) => c.before === null)!.after as (typeof summit.customers)[number];
    expect(created).toMatchObject({
      externalId: "CUST-9001",
      type: "contractor",
      terms: "net_30",
      defaultBillingId: created.addresses[0]!.id,
    });
    expect(result.rows[2]!.problems.map((p) => p.field)).toEqual(["email", "credit_limit"]);
    expect(dryRunSummary(result.counts)).toBe("Creates 1, updates 1, skips 0; 1 row has errors and is left out.");
  });

  it("matches a second import on external ID, so it updates instead of duplicating", () => {
    const ctx = context();
    const first = plan("customers", [{ external_id: "CUST-9001", name: "Maple Row", email: "a@maple.example" }], ctx);
    ctx.world.customers = [...ctx.world.customers, first.changes[0]!.after as (typeof summit.customers)[number]];
    const again = plan("customers", [{ external_id: "cust-9001", name: "Maple Row Builders" }], ctx);
    expect(again.counts).toMatchObject({ create: 0, update: 1 });
    const unchanged = plan("customers", [{ external_id: "CUST-9001", name: "Maple Row" }], ctx);
    expect(unchanged.rows[0]).toMatchObject({ action: "skip", note: "Nothing changed." });
  });

  it("flags a row that repeats an earlier one in the same file", () => {
    const result = plan("products", [
      {
        sku: "NEW-1",
        name: "A",
        category: "Laminate",
        unit: "carton",
        price: "10",
        cost: "5",
        sq_ft_per_carton: "20",
        supplier: summit.suppliers[0]!.name,
      },
      {
        sku: "new-1",
        name: "B",
        category: "Laminate",
        unit: "carton",
        price: "10",
        cost: "5",
        sq_ft_per_carton: "20",
        supplier: summit.suppliers[0]!.name,
      },
    ]);
    expect(result.rows[1]!.problems[0]!.message).toBe("Repeats row 2; each record once per file.");
  });

  it("names unknown suppliers and units a product needs", () => {
    const result = plan("products", [
      {
        sku: "NEW-2",
        name: "A",
        category: "Laminate",
        unit: "carton",
        price: "10",
        cost: "5",
        supplier: "Nobody Supply",
      },
      {
        sku: "NEW-3",
        name: "B",
        category: "Laminate",
        unit: "carton",
        price: "10",
        cost: "5",
        supplier: summit.suppliers[0]!.name,
      },
    ]);
    expect(result.rows[0]!.problems[0]!.message).toBe("No supplier matches “Nobody Supply”. Import suppliers first.");
    expect(result.rows[1]!.problems[0]!.field).toBe("sq_ft_per_carton");
  });

  it("adds two addresses to one customer in one file, building on each other", () => {
    const customer = summit.customers[0]!;
    const result = plan("addresses", [
      {
        customer: customer.email,
        label: "Job site",
        street: "1 Pine Way",
        city: "Denver",
        state: "CO",
        zip: "80202",
        default: "yes",
      },
      {
        customer: customer.name,
        label: "Delivery",
        street: "2 Pine Way",
        city: "Denver",
        state: "Colorado",
        zip: "80202",
      },
    ]);
    expect(result.counts.create).toBe(2);
    expect(result.changes).toHaveLength(1);
    const after = result.changes[0]!.after as typeof customer;
    expect(after.addresses).toHaveLength(customer.addresses.length + 2);
    expect(after.defaultJobSiteId).toBe(after.addresses.at(-2)!.id);
    expect(result.changes[0]!.before).toEqual(customer);
  });

  it("refuses unknown and showroom locations for stock", () => {
    const boxed = summit.products.find((p) => p.sqFtPerCarton)!;
    const showroom = summit.locations.find((l) => l.kind === "showroom")!;
    const result = plan("stock", [
      { sku: boxed.sku, warehouse: "Nowhere", quantity: "5" },
      { sku: boxed.sku, warehouse: showroom.name, quantity: "5" },
    ]);
    expect(result.rows.map((r) => r.problems[0]!.field)).toEqual(["warehouse", "warehouse"]);
  });

  it("writes one movement for the difference to a counted stock, and none when it matches", () => {
    const warehouse = summit.locations.find((l) => l.isDefault)!;
    const boxed = summit.products.find(
      (p) => p.sqFtPerCarton && boxedOnHand(summit.stockMovements, p.id, warehouse.id).gt(0),
    )!;
    const onHand = boxedOnHand(summit.stockMovements, boxed.id, warehouse.id);
    const result = plan("stock", [{ sku: boxed.sku, warehouse: warehouse.name, quantity: onHand.plus(7).toString() }]);
    expect(result.changes[0]!.after).toMatchObject({
      quantity: "7",
      kind: "adjustment",
      source: { kind: "count", number: "IMP-0001" },
    });
    const same = plan("stock", [{ sku: boxed.sku, warehouse: warehouse.name, quantity: onHand.toString() }]);
    expect(same.rows[0]!.action).toBe("skip");
  });

  it("adds a roll by roll number with its cost per sq ft from the product", () => {
    const carpet = summit.products.find((p) => p.category === "carpet" && p.widthFt)!;
    const warehouse = summit.locations.find((l) => l.isDefault)!;
    const result = plan("stock", [
      { sku: carpet.sku, warehouse: warehouse.name, roll_number: "R-NEW-1", length_ft: "110 ft" },
    ]);
    expect(result.changes[0]!.after).toMatchObject({
      rollNumber: "R-NEW-1",
      originalLengthFt: "110",
      remainingLengthFt: "110",
      widthFt: carpet.widthFt,
      cuts: [],
    });
  });

  it("brings over an open invoice as one untaxed line due on the customer's terms", () => {
    const customer = summit.customers.find((c) => c.terms === "net_30")!;
    const result = plan("invoices", [
      { number: "OB-1", customer: customer.email, issued: "2026-09-01", balance: "$1,200" },
    ]);
    expect(result.changes[0]!.after).toMatchObject({
      number: "OB-1",
      total: "1200.00",
      tax: "0.00",
      dueAt: "2026-10-01",
      taxRule: null,
    });
    const future = plan("invoices", [{ number: "OB-2", customer: customer.email, issued: "2099-01-01", balance: "5" }]);
    expect(future.rows[0]!.problems[0]!.field).toBe("issued");
  });

  it("leaves invoices made in the app alone", () => {
    const made = summit.invoices[0]!;
    const customer = summit.customers.find((c) => c.id === made.customerId)!;
    const result = plan("invoices", [
      { number: made.number, customer: customer.email, issued: "2026-09-01", balance: "10" },
    ]);
    expect(result.rows[0]).toMatchObject({ action: "skip", note: "Made in the app; change it on the invoice." });
  });

  it("brings over an open bill due on the supplier's terms", () => {
    const supplier = summit.suppliers.find((s) => s.terms === "net_30") ?? summit.suppliers[0]!;
    const result = plan("bills", [{ number: "B-77", supplier: supplier.name, issued: "2026-09-01", balance: "800" }]);
    expect(result.changes[0]!.after).toMatchObject({ supplierId: supplier.id, poId: null, total: "800.00" });
  });

  it("creates employees with a manager from the same file", () => {
    const result = plan("employees", [
      { name: "Jordan Reyes", email: "jordan@work.example", pay_rate: "30", state: "CO" },
      { name: "Sam Ito", email: "sam@work.example", pay_rate: "25", state: "Colorado", manager: "jordan@work.example" },
    ]);
    const [lead, report] = result.changes.map((c) => c.after as (typeof summit.employees)[number]);
    expect(report!.managerId).toBe(lead!.id);
    expect(report!.state).toBe("CO");
  });
});

describe("templates and reports (spec G1 steps 2 and 7)", () => {
  it("offers kinds by module", () => {
    expect(importKindsFor(["platform", "hr"])).toEqual(["employees", "timesheets"]);
    expect(importKindsFor(["platform", "core"])).not.toContain("employees");
  });

  it("marks required columns in the template, and every template example row reads cleanly", () => {
    for (const kind of Object.keys(IMPORT_HANDLERS) as ImportKind[]) {
      const def = importKind(kind);
      const [header, ...examples] = templateTable(def);
      expect(header).toContain(`${def.fields[0]!.label}${def.fields[0]!.required ? " *" : ""}`);
      for (const row of examples) {
        def.fields.forEach((f, i) => expect(readCell(f, row[i]!), `${kind}.${f.key}`).not.toHaveProperty("error"));
      }
      expect(autoMap(def, header!)).toEqual(Object.fromEntries(def.fields.map((f, i) => [f.key, header![i]])));
    }
  });

  it("lists each problem with its row, column and value", () => {
    const result = plan("customers", [{ name: "X", email: "bad" }]);
    expect(errorTable(importKind("customers"), result)).toEqual([
      ["Row", "Column", "Value", "Problem"],
      ["2", "Email", "bad", "“bad” is not an email address."],
    ]);
  });
});
