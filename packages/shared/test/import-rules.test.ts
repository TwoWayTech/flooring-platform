import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  autoMap,
  batchSummary,
  canonicalJson,
  countsText,
  dec,
  emptyImportWorld,
  FEATURES,
  FULL_IMPORT_HOLDER,
  hiddenSensitiveFields,
  IMPORT_HANDLERS,
  IMPORT_KIND_KEYS,
  IMPORT_KIND_LIST,
  importAuditAction,
  importKind,
  importKindRefusal,
  importKindsOpen,
  importRequestProblem,
  mappedTable,
  mappingFor,
  needsTimesheet,
  planActions,
  planImport,
  PRODUCT_MODULES,
  productUndoProblem,
  readCell,
  resolveAccess,
  roleTemplate,
  sameRecord,
  sensitiveColumnRefusal,
  type ColumnMapping,
  type CompanyFixtures,
  type Customer,
  type ImportBatch,
  type ImportChange,
  type ImportHolder,
  type ImportKind,
  type ImportUser,
  type ImportWorld,
  type MovementKind,
  type PermissionKey,
  type PlanContext,
  type Product,
  type StockMovement,
  type Supplier,
  type SupplierContact,
} from "../src";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;

const OWNER: ImportUser = { id: "u-owner", name: "Riley Owner", email: "owner@summit.example", status: "active" };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: nextId("cus"),
    type: "homeowner",
    name: "Avery Collins",
    contactName: "Avery Collins",
    email: "avery@mail.example",
    phone: "",
    addresses: [],
    defaultBillingId: null,
    defaultJobSiteId: null,
    terms: "due_on_receipt",
    creditLimit: "0.00",
    taxExempt: false,
    certificate: null,
    salesRepId: OWNER.id,
    createdAt: "2026-11-01",
    ...over,
  };
}

function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: nextId("sup"),
    name: "Ridgeway Flooring Supply",
    type: "goods",
    status: "active",
    accountNumber: "",
    email: "orders@ridgeway.example",
    phone: "",
    terms: "net_30",
    creditLimit: "0.00",
    categories: [],
    address: { street: "", city: "", state: "", zip: "" },
    track1099: false,
    taxForm: null,
    notes: "",
    ...over,
  };
}

const SUPPLIER = supplier({ id: "sup-main" });

function product(over: Partial<Product> = {}): Product {
  return {
    id: nextId("prd"),
    sku: "LV-1",
    name: "Harbor Oak Wide Plank",
    brand: "",
    collection: "",
    colorName: "",
    swatch: "#A39A8E",
    category: "lvp",
    unit: "sq_ft",
    price: "4.2500",
    cost: "3.4000",
    sqFtPerCarton: "23.640",
    attributes: {},
    supplierId: SUPPLIER.id,
    createdAt: "2026-11-01",
    ...over,
  };
}

function movement(productId: string, kind: MovementKind): StockMovement {
  return {
    id: nextId("mov"),
    at: "2026-11-01T09:00",
    productId,
    locationId: "loc-1",
    quantity: kind === "transfer_out" ? "-10" : "10",
    kind,
    source: { kind: kind === "transfer_out" ? "transfer" : "receipt", id: "doc-1", number: "DOC-1" },
    byUserId: null,
  };
}

/** A plan context over a world made of `parts` (and the Owner as the one user unless given). */
function contextFor(parts: Partial<ImportWorld> = {}): PlanContext {
  let n = 0;
  return {
    world: emptyImportWorld({ users: [OWNER], ...parts }),
    companyId: "summit",
    today: "2026-11-16",
    now: "2026-11-16T07:30",
    actorId: OWNER.id,
    batch: { id: "imp-1", number: "IMP-1001" },
    newId: (kind) => `new-${kind}-${++n}`,
    workweekStartDay: 1,
  };
}

/** A file under the template's own headers, as the wizard maps it. */
function requestFor(kind: ImportKind, rows: Record<string, string>[]) {
  const def = importKind(kind);
  const headers = def.fields.map((f) => f.label);
  const table = { headers, rows: rows.map((r) => def.fields.map((f) => r[f.key] ?? "")) };
  return { kind, fileName: "test.csv", table, mapping: autoMap(def, headers) };
}

function plan(kind: ImportKind, rows: Record<string, string>[], ctx: PlanContext) {
  return planImport(IMPORT_HANDLERS[kind], requestFor(kind, rows), ctx);
}

/** The first problem of each row, as "field: message". */
const problemsOf = (result: ReturnType<typeof plan>) =>
  result.rows.map((r) => (r.problems[0] ? `${r.problems[0].field}: ${r.problems[0].message}` : r.action));

/** A record as the database hands it back: decimals at their column's scale, jsonb keys in jsonb's order. */
function asStored(change: ImportChange): { id: string } {
  if (change.collection === "products") {
    const p = change.after as Product;
    const stored: Product = {
      ...p,
      price: dec(p.price).toFixed(4),
      cost: dec(p.cost).toFixed(4),
      ...(p.sqFtPerCarton ? { sqFtPerCarton: dec(p.sqFtPerCarton).toFixed(3) } : {}),
    };
    return stored;
  }
  if (change.collection === "suppliers") {
    const s = change.after as Supplier;
    const { street, city, state, zip } = s.address;
    const stored: Supplier = {
      ...s,
      creditLimit: dec(s.creditLimit).toFixed(2),
      categories: [...s.categories].reverse(),
      address: street ? { zip, city, state, street, county: "Denver" } : s.address,
    };
    return stored;
  }
  if (change.collection === "customers") {
    const c = change.after as Customer;
    const stored: Customer = {
      ...c,
      creditLimit: dec(c.creditLimit).toFixed(2),
      addresses: c.addresses.map(({ zip, street, state, label, id, city }) => ({
        zip,
        street,
        state,
        label,
        id,
        city,
      })),
    };
    return stored;
  }
  return change.after as { id: string };
}

/** The world with the plan's changes written as the database would store them. */
function written(world: ImportWorld, changes: readonly ImportChange[]): ImportWorld {
  const next = emptyImportWorld({
    ...world,
    customers: [...world.customers],
    suppliers: [...world.suppliers],
    supplierContacts: [...world.supplierContacts],
    products: [...world.products],
  });
  for (const change of changes) {
    const list = next[change.collection] as { id: string }[];
    const at = list.findIndex((r) => r.id === change.id);
    if (at >= 0) list[at] = asStored(change);
    else list.push(asStored(change));
  }
  return next;
}

const holder = (keys: readonly PermissionKey[], dataScope: ImportHolder["dataScope"] = "all"): ImportHolder => ({
  permissions: new Set(keys),
  dataScope,
});

const FLOORING = PRODUCT_MODULES.flooring;
const ADDRESS = { street: "12 Elm Street", city: "Denver", state: "CO", zip: "80216" };

describe("SR-1 to SR-3: cells within the columns' limits (ADR 0057 S-12)", () => {
  const field = (kind: ImportKind, key: string) => importKind(kind).fields.find((f) => f.key === key)!;

  it("SR-1 refuses a 201-character name and takes 200", () => {
    expect(readCell(field("customers", "name"), "a".repeat(201))).toEqual({
      error: "Name is at most 200 characters.",
    });
    expect(readCell(field("customers", "name"), ` ${"a".repeat(200)} `)).toEqual({ value: "a".repeat(200) });
  });

  it("SR-2 refuses money with more than ten whole digits", () => {
    expect(readCell(field("customers", "credit_limit"), "12345678901")).toEqual({
      error: "“12345678901” is too large.",
    });
    expect(readCell(field("customers", "credit_limit"), "1,234,567,890.12")).toEqual({ value: "1234567890.12" });
    expect(readCell(field("customers", "credit_limit"), "00001234567890")).toEqual({ value: "1234567890.00" });
  });

  it("SR-3 refuses a fourth decimal of coverage and leaves timesheet hours to the kind", () => {
    const coverage = field("products", "sq_ft_per_carton");
    expect(readCell(coverage, "1.2345")).toEqual({ error: "“1.2345” has more than 3 decimals." });
    expect(readCell(coverage, "23.64 sq ft")).toEqual({ value: "23.64" });
    expect(readCell(coverage, "23.6400")).toEqual({ value: "23.64" });
    expect(readCell(field("products", "reorder_point"), "12345678901")).toEqual({
      error: "“12345678901” is too large.",
    });
    const employee = summit.employees.find(needsTimesheet)!;
    const ctx = contextFor({ employees: summit.employees });
    const result = plan(
      "timesheets",
      [{ employee_email: employee.email, work_date: "2020-02-04", hours_worked: "7.3333" }],
      ctx,
    );
    expect(result.rows[0]!.problems).toEqual([{ field: "hours_worked", message: "Use at most two decimals." }]);
  });
});

describe("SR-4: a second import of the same file skips (ADR 0057 S-11)", () => {
  it("skips customers, addresses, suppliers and products after their changes are stored", () => {
    const known = customer({ id: "cus-known", externalId: "CUST-1", email: "known@mail.example" });
    const files: [ImportKind, Record<string, string>[]][] = [
      [
        "customers",
        [
          { external_id: "CUST-9", name: "Maple Row", email: "maple@mail.example", credit_limit: "25000", ...ADDRESS },
          { external_id: "CUST-1", name: known.name, credit_limit: "1200.5" },
        ],
      ],
      [
        "addresses",
        [
          { customer: "CUST-1", label: "Job site", ...ADDRESS, default: "yes" },
          { customer: "known@mail.example", label: "Billing", ...ADDRESS, street: "9 Pine Way" },
        ],
      ],
      [
        "suppliers",
        [
          {
            external_id: "VEN-9",
            name: "Cobalt Trim Works",
            email: "sales@cobalt.example",
            contact_name: "Sam Ito",
            credit_limit: "25000",
            categories: "Carpet; LVP and LVT",
            ...ADDRESS,
          },
        ],
      ],
      [
        "products",
        [
          {
            sku: "SY-1",
            name: "Plush",
            category: "Carpet",
            unit: "sq yd",
            price: "89.95",
            cost: "54.10",
            width_ft: "12",
            supplier: SUPPLIER.name,
          },
          {
            sku: "CT-1",
            name: "Tile",
            category: "Porcelain tile",
            unit: "cartons",
            price: "45.00",
            cost: "30",
            sq_ft_per_carton: "20",
            supplier: SUPPLIER.name,
          },
          {
            sku: "AD-1",
            name: "Glue",
            category: "Adhesives and trims",
            unit: "each",
            price: "24.50",
            cost: "11.20",
            reorder_point: "40",
            supplier: SUPPLIER.name,
          },
        ],
      ],
    ];
    for (const [kind, rows] of files) {
      const first = contextFor({ customers: [known], suppliers: [SUPPLIER] });
      const once = plan(kind, rows, first);
      expect(once.counts.error, `${kind}: ${problemsOf(once).join(" | ")}`).toBe(0);
      expect(once.counts.create + once.counts.update, kind).toBe(rows.length);
      const again = plan(kind, rows, { ...first, world: written(first.world, once.changes) });
      expect(
        again.rows.map((r) => r.action),
        `${kind}: ${problemsOf(again).join(" | ")}`,
      ).toEqual(rows.map(() => "skip"));
    }
  });

  it("compares stored decimals as numbers, a jsonb address by its four fields and categories as a set", () => {
    const stored = supplier({
      name: "Ridge Supply",
      email: "ridge@supply.example",
      creditLimit: "25000.00",
      categories: ["lvp", "carpet"],
      address: {
        zip: "80216",
        city: "Denver",
        state: "CO",
        street: "12 Elm Street",
        county: "Denver",
      } as Supplier["address"],
    });
    const lvp = product({ supplierId: stored.id });
    const buyer = customer({ externalId: "CUST-3", creditLimit: "25000.00" });
    const ctx = contextFor({ customers: [buyer], suppliers: [stored], products: [lvp] });
    const suppliers = plan(
      "suppliers",
      [
        {
          name: "Ridge Supply",
          email: "ridge@supply.example",
          credit_limit: "25000",
          categories: "Carpet; LVP and LVT",
          street: "12 elm  street",
          city: "DENVER",
          state: "CO",
          zip: "80216",
        },
      ],
      ctx,
    );
    const products = plan(
      "products",
      [
        {
          sku: "lv-1",
          name: lvp.name,
          category: "LVP and LVT",
          unit: "sq ft",
          price: "4.25",
          cost: "3.40",
          sq_ft_per_carton: "23.64",
          supplier: "Ridge Supply",
        },
      ],
      ctx,
    );
    const customers = plan("customers", [{ external_id: "CUST-3", name: buyer.name, credit_limit: "25000" }], ctx);
    expect([suppliers, products, customers].map((p) => p.rows[0]!.action)).toEqual(["skip", "skip", "skip"]);
  });
});

describe("SR-5 to SR-7: products with stock history and retired SKUs (ADR 0057 S-5, S-6)", () => {
  const lvp = product({ id: "prd-lvp" });
  const row = {
    sku: "LV-1",
    name: lvp.name,
    category: "LVP and LVT",
    unit: "sq ft",
    price: "4.25",
    cost: "3.40",
    sq_ft_per_carton: "23.64",
    supplier: SUPPLIER.name,
  };
  const frozen = (field: string) =>
    `${field}: LV-1 has stock history, so its cost, category, selling unit, coverage and roll width stay as they are. Leave them as they are or leave the row out.`;
  const roll = { ...summit.rolls[0]!, productId: lvp.id };
  const histories: [string, Partial<ImportWorld>][] = [
    ["a receipt", { stockMovements: [movement(lvp.id, "receipt")] }],
    ["stock in transit", { stockMovements: [movement(lvp.id, "transfer_out")] }],
    ["a deleted roll the API counts", { productsWithStock: new Set([lvp.id]) }],
    ["a roll", { rolls: [roll] }],
  ];

  it("SR-5 refuses a cost change once a product has any stock history", () => {
    for (const [name, history] of histories) {
      const ctx = contextFor({ suppliers: [SUPPLIER], products: [lvp], ...history });
      expect(problemsOf(plan("products", [{ ...row, cost: "3.60" }], ctx)), name).toEqual([frozen("cost")]);
      const same = plan("products", [{ ...row, name: "Harbor Oak", cost: "3.4" }], ctx);
      expect(same.rows[0]!.action, name).toBe("update");
      expect((same.changes[0]!.after as Product).cost, name).toBe("3.4000");
    }
    const fresh = plan("products", [{ ...row, cost: "3.60" }], contextFor({ suppliers: [SUPPLIER], products: [lvp] }));
    expect((fresh.changes[0]!.after as Product).cost).toBe("3.60");
  });

  it("SR-6 refuses category, unit, coverage and width changes with stock history, and allows them without", () => {
    const carpet = product({
      id: "prd-carpet",
      sku: "CP-1",
      category: "carpet",
      widthFt: 12,
      sqFtPerCarton: undefined,
    });
    const carpetRow = { ...row, sku: "CP-1", category: "Carpet", sq_ft_per_carton: "", width_ft: "15" };
    const changes = [
      { ...row, category: "Laminate" },
      { ...row, unit: "each" },
      { ...row, sq_ft_per_carton: "25" },
      carpetRow,
    ];
    const stocked = contextFor({
      suppliers: [SUPPLIER],
      products: [lvp, carpet],
      productsWithStock: new Set([lvp.id, carpet.id]),
    });
    for (const change of changes) {
      const frozenFor = frozen("unit").replace("LV-1", change.sku);
      expect(problemsOf(plan("products", [change], stocked))).toEqual([frozenFor]);
      const free = plan("products", [change], contextFor({ suppliers: [SUPPLIER], products: [lvp, carpet] }));
      expect(free.rows[0]!.action).toBe("update");
    }
  });

  it("SR-7 refuses a new SKU a deleted product held, in any case, and still updates a live one", () => {
    const ctx = contextFor({ suppliers: [SUPPLIER], products: [lvp], retiredSkus: ["rw-9", "lv-1"] });
    const result = plan(
      "products",
      [
        { ...row, sku: "RW-9" },
        { ...row, name: "Harbor Oak" },
      ],
      ctx,
    );
    expect(problemsOf(result)).toEqual(["sku: SKU “RW-9” belonged to a deleted product. Use another SKU.", "update"]);
  });
});

describe("SR-8 to SR-10: suppliers, reps and addresses", () => {
  it("SR-8 gives a new supplier pay-on-order terms and refuses a contact that can't be reached", () => {
    const ctx = contextFor();
    const result = plan(
      "suppliers",
      [
        { name: "New Supply", email: "orders@new.example" },
        { name: "Quiet Supply", contact_name: "Morgan Hale" },
        { name: "Phone Supply", phone: "(303) 555-0110", contact_name: "Sam Ito" },
      ],
      ctx,
    );
    expect(problemsOf(result)).toEqual([
      "create",
      "contact_name: A contact needs the supplier's Email or Phone on the same row, or leave Contact empty.",
      "create",
    ]);
    expect((result.changes[0]!.after as Supplier).terms).toBe("pay_on_order");
    const contact = result.changes.find((c) => c.collection === "supplierContacts")!.after as SupplierContact;
    expect(contact).toMatchObject({
      name: "Sam Ito",
      officePhone: "(303) 555-0110",
      email: "",
      preferredMethod: "call",
    });
  });

  it("SR-9 refuses a sales rep who is disabled or invited", () => {
    const users: ImportUser[] = [
      OWNER,
      { id: "u-2", name: "Dana Reyes", email: "dana@summit.example", status: "disabled" },
      { id: "u-3", name: "Jo Park", email: "jo@summit.example", status: "invited" },
    ];
    const result = plan(
      "customers",
      [
        { external_id: "C-1", name: "A", sales_rep: "dana@summit.example" },
        { external_id: "C-2", name: "B", sales_rep: "Jo Park" },
        { external_id: "C-3", name: "C", sales_rep: "owner@summit.example" },
      ],
      contextFor({ users }),
    );
    expect(problemsOf(result)).toEqual([
      "sales_rep: Dana Reyes is not an active user.",
      "sales_rep: Jo Park is not an active user.",
      "create",
    ]);
  });

  it("SR-10 keeps a customer to 50 addresses in both kinds", () => {
    const addresses = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `adr-${i}`,
        label: "job_site" as const,
        ...ADDRESS,
        street: `${i} Main St`,
      }));
    const full = customer({ externalId: "FULL", email: "full@mail.example", addresses: addresses(50) });
    const room = customer({ externalId: "ROOM", email: "room@mail.example", addresses: addresses(49) });
    const ctx = contextFor({ customers: [full, room] });
    const refused = "street: A customer can have at most 50 addresses.";
    const customers = plan(
      "customers",
      [
        { external_id: "FULL", name: full.name, ...ADDRESS, street: "1 New Road" },
        { external_id: "ROOM", name: room.name, ...ADDRESS, street: "1 New Road" },
      ],
      ctx,
    );
    expect(problemsOf(customers)).toEqual([refused, "update"]);
    const added = plan(
      "addresses",
      [
        { customer: "FULL", ...ADDRESS, street: "2 New Road" },
        { customer: "FULL", ...ADDRESS, street: "3 Main St", label: "Billing" },
        { customer: "ROOM", ...ADDRESS, street: "2 New Road" },
      ],
      ctx,
    );
    expect(problemsOf(added)).toEqual([refused, "update", "create"]);
  });
});

describe("SR-11 to SR-13: who may import what (ADR 0057 S-1 to S-4)", () => {
  it("SR-11 refuses in order: module, switch, scope, then each kind key", () => {
    expect(importKindRefusal("customers", ["platform", "hr"], holder([], "own"))).toEqual({
      status: 403,
      code: "module_not_enabled",
      message: "This company does not have the module for this import.",
    });
    const feature = FEATURES["sales.customers"] as { enabled: boolean };
    feature.enabled = false;
    try {
      expect(importKindRefusal("addresses", FLOORING, holder([], "branch"))).toEqual({
        status: 404,
        code: "not_found",
        message: "This kind of import is not available.",
      });
    } finally {
      feature.enabled = true;
    }
    expect(
      importKindRefusal("bills", FLOORING, FULL_IMPORT_HOLDER, (key) => key !== "purchasing.orders"),
    ).toMatchObject({
      status: 404,
    });
    expect(importKindRefusal("customers", FLOORING, holder(ALL_PERMISSION_KEYS, "branch"))).toEqual({
      status: 403,
      code: "forbidden",
      message: "Importing needs company-wide data scope, because rows are matched against every record.",
    });
    for (const kind of IMPORT_KIND_LIST) {
      expect(
        IMPORT_KIND_KEYS[kind].some((key) => key.endsWith(".view")),
        kind,
      ).toBe(true);
      expect(importKindRefusal(kind, FLOORING, FULL_IMPORT_HOLDER), kind).toBeNull();
      for (const key of IMPORT_KIND_KEYS[kind]) {
        const refusal = importKindRefusal(kind, FLOORING, holder(ALL_PERMISSION_KEYS.filter((k) => k !== key)));
        expect(refusal, `${kind} without ${key}`).toEqual({
          status: 403,
          code: "forbidden",
          message: `Your role can't see, add and change ${importKind(kind).label.toLowerCase()}, so it can't import them.`,
        });
      }
    }
    expect(
      importKindRefusal(
        "products",
        FLOORING,
        holder(ALL_PERMISSION_KEYS.filter((k) => k !== "purchasing.supplier.view")),
      )?.message,
    ).toBe("Your role can't see, add and change products, so it can't import them.");
  });

  it("SR-12 refuses a chosen sensitive column without the keys that reveal it", () => {
    const customers = ["customers.customer.view", "customers.customer.create", "customers.customer.edit"] as const;
    const credit: ColumnMapping = { name: "Name", credit_limit: "Credit" };
    expect(sensitiveColumnRefusal("customers", credit, holder(customers))).toEqual({
      status: 403,
      code: "forbidden",
      message: "Your role can't see credit limit, so leave the Credit limit column out.",
    });
    expect(sensitiveColumnRefusal("customers", { ...credit, credit_limit: null }, holder(customers))).toBeNull();
    expect(
      sensitiveColumnRefusal("customers", credit, holder([...customers, "customers.customer.view_sensitive"])),
    ).toBeNull();
    const suppliers: [PermissionKey[], boolean][] = [
      [["customers.customer.view_sensitive"], false],
      [["purchasing.bill.view"], false],
      [["customers.customer.view_sensitive", "purchasing.bill.view"], true],
      [["customers.customer.view_sensitive", "inventory.product.view_sensitive"], true],
    ];
    for (const [keys, allowed] of suppliers) {
      expect(sensitiveColumnRefusal("suppliers", credit, holder(keys)) === null, keys.join()).toBe(allowed);
    }
    expect(sensitiveColumnRefusal("products", { cost: "Cost" }, holder([]))?.message).toBe(
      "Your role can't see cost, so leave the Cost column out.",
    );
  });

  it("SR-13 opens the kinds each role may import", () => {
    const owner = resolveAccess([{ id: "owner", ...roleTemplate("owner") }], ALL_PERMISSION_KEYS, FLOORING);
    expect(importKindsOpen(FLOORING, owner)).toEqual([...IMPORT_KIND_LIST]);
    const hrOwner = resolveAccess([{ id: "owner", ...roleTemplate("owner") }], ALL_PERMISSION_KEYS, PRODUCT_MODULES.hr);
    expect(importKindsOpen(PRODUCT_MODULES.hr, hrOwner)).toEqual(["employees", "timesheets"]);
    const customersOnly = holder(["customers.customer.view", "customers.customer.create", "customers.customer.edit"]);
    expect(importKindsOpen(FLOORING, customersOnly)).toEqual(["customers", "addresses"]);
  });
});

describe("SR-14 and SR-15: the request and its column choices (ADR 0057 S-12, S-17)", () => {
  const def = importKind("customers");

  it("SR-14 names the first thing wrong with a request", () => {
    const base = requestFor("customers", [{ external_id: "C-1", name: "A" }]);
    expect(importRequestProblem(def, { ...base, mapping: { ...base.mapping, name: null } })).toBe(
      "Choose the column for Name.",
    );
    expect(importRequestProblem(def, { ...base, mapping: { ...base.mapping, phone: "Mobile" } })).toBe(
      "“Mobile” is not a column of this file.",
    );
    const rows = Array.from({ length: 2001 }, () => base.table.rows[0]!);
    expect(importRequestProblem(def, { ...base, table: { ...base.table, rows } })).toBe(
      "This file has 2001 rows. Import up to 2,000 at a time; split the file.",
    );
    const long = requestFor("customers", [
      { external_id: "C-1", name: "A" },
      { external_id: "C-2", name: "x".repeat(1001) },
    ]);
    expect(importRequestProblem(def, long)).toBe(
      "Row 3: a cell under “Name” is longer than 1,000 characters. Shorten it or leave that column out.",
    );
    const notes = {
      ...base,
      table: { headers: [...base.table.headers, "Notes"], rows: [[...base.table.rows[0]!, "n".repeat(5000)]] },
    };
    expect(importRequestProblem(def, notes)).toBeNull();
  });

  it("SR-15 reads only the kind's own fields from the column choices", () => {
    expect(mappingFor(def, { name: "Name", favourite: "Color" })).toEqual({
      problem: "The column choices name a field this import doesn't have.",
    });
    const hostile = JSON.parse('{"__proto__": {"polluted": "yes"}, "name": "Name"}') as Record<string, string | null>;
    expect(mappingFor(def, hostile)).toEqual({ problem: "The column choices name a field this import doesn't have." });
    const mapping = mappingFor(def, { name: "Name", email: "", phone: null }) as ColumnMapping;
    expect(Object.keys(mapping)).toEqual(def.fields.map((f) => f.key));
    expect(mapping).toMatchObject({ name: "Name", email: null, phone: null, external_id: null });
    expect(Object.getPrototypeOf(mapping)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("sends only the chosen columns, in field order, with every row", () => {
    const request = {
      kind: "customers" as const,
      fileName: "c.csv",
      table: {
        headers: ["Notes", "E-mail", "Customer Name"],
        rows: [["secret", "a@x.example", "A"], ["", "", ""], ["n"]],
      },
      mapping: { name: "Customer Name", email: "E-mail", phone: null },
    };
    expect(mappedTable(def, request)).toEqual({
      headers: ["Customer Name", "E-mail"],
      rows: [
        ["A", "a@x.example"],
        ["", ""],
        ["", ""],
      ],
    });
  });
});

describe("SR-16 to SR-18: undo and world helpers", () => {
  it("SR-16 compares records by content, not key order", () => {
    expect(sameRecord({ a: 1, b: { y: 2, x: [1, 2] } }, { b: { x: [1, 2], y: 2 }, a: 1 })).toBe(true);
    expect(sameRecord({ a: 1, c: undefined }, { a: 1 })).toBe(true);
    expect(sameRecord([1, 2], [2, 1])).toBe(false);
    expect(sameRecord({ cost: "3.40" }, { cost: "3.4000" })).toBe(false);
    expect(canonicalJson({ zip: "1", city: "D", street: "S" })).toBe('{"city":"D","street":"S","zip":"1"}');
  });

  it("SR-17 keeps record versions out of a batch summary and words the audit", () => {
    const batch: ImportBatch = {
      id: "b-1",
      number: "IMP-1001",
      kind: "addresses",
      fileName: "a.csv",
      at: "2026-11-16T07:30",
      byName: "Riley Owner",
      mapping: { customer: "Customer" },
      counts: { create: 2, update: 0, skip: 0, error: 1 },
      changes: [{ collection: "customers", id: "c-1", before: null, after: { creditLimit: "9.00" } }],
      undoneAt: null,
      undoneBy: null,
    };
    const summary = batchSummary(batch);
    expect(summary).not.toHaveProperty("changes");
    expect(JSON.stringify(summary)).not.toContain("creditLimit");
    expect(countsText(batch.counts)).toBe("2 created, 0 updated, 0 skipped, 1 with errors");
    expect(importAuditAction("addresses")).toBe("Imported customer addresses");
  });

  it("SR-18 builds a world from the parts given, every other list empty", () => {
    const customers = [customer()];
    const world = emptyImportWorld({ customers, suppliers: undefined });
    expect(world.customers).toBe(customers);
    for (const [key, list] of Object.entries(world)) {
      if (key !== "customers") expect(list, key).toEqual([]);
    }
  });
});

describe("SR-19: a key that matches several records is refused (ADR 0057 S-16)", () => {
  it("refuses shared emails, external IDs, names, SKUs and rep names, and takes one match", () => {
    const twins = [
      customer({ externalId: "CUST-A", email: "shared@mail.example", name: "Twin A" }),
      customer({ externalId: "CUST-B", email: "shared@mail.example", name: "Twin B" }),
      customer({ externalId: "DUP", email: "dup1@mail.example" }),
      customer({ externalId: "dup", email: "dup2@mail.example" }),
    ];
    const ridges = [
      supplier({ name: "Ridge Supply", email: "a@ridge.example", externalId: "VEN-1" }),
      supplier({ name: "Ridge Supply", email: "b@ridge.example" }),
    ];
    const users: ImportUser[] = [
      OWNER,
      { id: "u-2", name: "Sam Lee", email: "sam.lee@summit.example", status: "active" },
      { id: "u-3", name: "Sam Lee", email: "sam.l@summit.example", status: "active" },
    ];
    const skus = [
      product({ sku: "rw-1", supplierId: ridges[0]!.id }),
      product({ sku: "RW-1", supplierId: ridges[0]!.id }),
    ];
    const ctx = contextFor({ customers: twins, suppliers: ridges, products: skus, users });
    expect(
      problemsOf(
        plan(
          "customers",
          [
            { name: "X", email: "shared@mail.example" },
            { external_id: "dup", name: "Y" },
            { name: "Z", email: "new@mail.example", sales_rep: "Sam Lee" },
            { external_id: "CUST-A", name: "Twin A", email: "shared@mail.example", sales_rep: "sam.l@summit.example" },
          ],
          ctx,
        ),
      ),
    ).toEqual([
      "email: 2 customers have the email “shared@mail.example”. Give an External ID instead.",
      "external_id: 2 customers have the External ID “dup”. Fix them in the app first.",
      "sales_rep: 2 users match “Sam Lee”. Use their email.",
      "update",
    ]);
    expect(
      problemsOf(
        plan(
          "addresses",
          [
            { customer: "shared@mail.example", ...ADDRESS },
            { customer: "CUST-B", ...ADDRESS },
          ],
          ctx,
        ),
      ),
    ).toEqual(["customer: 2 customers match “shared@mail.example”. Use their External ID or email.", "create"]);
    expect(
      problemsOf(
        plan("suppliers", [{ name: "Ridge Supply" }, { name: "Ridge Supply", email: "b@ridge.example" }], ctx),
      ),
    ).toEqual(["name: 2 suppliers match “Ridge Supply”. Use their External ID or email.", "skip"]);
    const item = { name: "Item", category: "Services", unit: "each", price: "10", cost: "5" };
    expect(
      problemsOf(
        plan(
          "products",
          [
            { ...item, sku: "NEW-1", supplier: "Ridge Supply" },
            { ...item, sku: "Rw-1", supplier: "VEN-1" },
            { ...item, sku: "NEW-2", supplier: "VEN-1" },
          ],
          ctx,
        ),
      ),
    ).toEqual([
      "supplier: 2 suppliers match “Ridge Supply”. Use their External ID or email.",
      "sku: 2 products have the SKU “Rw-1”. Fix them in the app first.",
      "create",
    ]);
  });

  it("never treats two emails that differ only by punctuation as one", () => {
    const ctx = contextFor({ customers: [customer({ email: "j-smith@mail.example" })] });
    const result = plan("customers", [{ name: "J Smith", email: "j_smith@mail.example" }], ctx);
    expect(result.rows[0]!.action).toBe("create");
  });
});

describe("SR-20: planning is linear in rows plus records (ADR 0057 M7)", () => {
  const timed = (run: () => ReturnType<typeof plan>) => {
    const start = performance.now();
    const result = run();
    return { result, ms: performance.now() - start };
  };

  it("plans 2,000 rows against 20,000 records in under two seconds per kind", () => {
    const customers = Array.from({ length: 20_000 }, (_, i) =>
      customer({ id: `c-${i}`, externalId: `C-${i}`, name: `Customer ${i}`, email: `c${i}@mail.example` }),
    );
    const suppliers = Array.from({ length: 2000 }, (_, i) =>
      supplier({ id: `s-${i}`, name: `Supplier ${i}`, email: `s${i}@supply.example` }),
    );
    const products = Array.from({ length: 20_000 }, (_, i) =>
      product({ id: `p-${i}`, sku: `P-${i}`, supplierId: `s-${i % 2000}` }),
    );
    const ctx = contextFor({ customers, suppliers, products, productsWithStock: new Set(products.map((p) => p.id)) });
    const runs = [
      timed(() =>
        plan(
          "customers",
          Array.from({ length: 2000 }, (_, i): Record<string, string> =>
            i % 2
              ? { external_id: `C-${i * 10}`, name: `Customer ${i * 10}`, phone: "555-0100" }
              : { external_id: `N-${i}`, name: `New ${i}` },
          ),
          ctx,
        ),
      ),
      timed(() =>
        plan(
          "addresses",
          Array.from({ length: 2000 }, (_, i) => ({
            customer: `c${i * 10}@mail.example`,
            ...ADDRESS,
            street: `${i} Main St`,
          })),
          ctx,
        ),
      ),
      timed(() =>
        plan(
          "products",
          Array.from({ length: 2000 }, (_, i) => ({
            sku: i % 2 ? `P-${i * 10}` : `NEW-${i}`,
            name: `Renamed ${i}`,
            category: "LVP and LVT",
            unit: "sq ft",
            price: "4.25",
            cost: "3.40",
            sq_ft_per_carton: "23.64",
            supplier: `Supplier ${i % 2000}`,
          })),
          ctx,
        ),
      ),
    ];
    for (const { result, ms } of runs) {
      expect(
        result.counts.error,
        problemsOf(result).find((p) => p.includes(":")),
      ).toBe(0);
      expect(result.counts.create + result.counts.update).toBe(2000);
      expect(ms).toBeLessThan(2000);
    }
  });
});

describe("SR-21 to SR-23: control characters and product sizes (ADR 0057 S-17, S-18)", () => {
  const field = (kind: ImportKind, key: string) => importKind(kind).fields.find((f) => f.key === key)!;

  it("SR-21 refuses hidden control characters, except tab and line breaks in a timesheet note", () => {
    const name = field("customers", "name");
    for (const hidden of ["\u0000", "\u0007", "\u001b", "\n", "\u007f"]) {
      expect(readCell(name, `Sam${hidden}Lee`), JSON.stringify(hidden)).toEqual({
        error: "Name has a hidden control character. Remove it and try again.",
      });
    }
    expect(readCell(field("timesheets", "note"), "Late\tdelivery\r\nsecond line")).toEqual({
      value: "Late\tdelivery\r\nsecond line",
    });
    expect(readCell(field("timesheets", "note"), "Bell\u0007")).toHaveProperty("error");
    expect(readCell(name, "Sam Lee\n")).toEqual({ value: "Sam Lee" });
  });

  it("SR-22 refuses zero coverage or width and a converted price that no longer fits", () => {
    expect(readCell(field("products", "sq_ft_per_carton"), "0")).toEqual({
      error: "Sq ft per carton must be more than 0.",
    });
    expect(readCell(field("products", "width_ft"), "0.000 ft")).toEqual({
      error: "Roll width (ft) must be more than 0.",
    });
    // The column is numeric(14,3), so a fourth decimal of coverage is refused before any division.
    expect(readCell(field("products", "sq_ft_per_carton"), "0.0001")).toEqual({
      error: "“0.0001” has more than 3 decimals.",
    });
    const tile = { name: "Tile", category: "Porcelain tile", unit: "cartons", supplier: SUPPLIER.name };
    const result = plan(
      "products",
      [
        { ...tile, sku: "T-1", price: "5.00", cost: "1.00", sq_ft_per_carton: "0.001" },
        { ...tile, sku: "T-2", price: "9999999999.99", cost: "1.00", sq_ft_per_carton: "0.5" },
        { ...tile, sku: "T-3", price: "1.00", cost: "9999999999.99", sq_ft_per_carton: "0.5" },
        { ...tile, sku: "T-4", price: "100", cost: "1", sq_ft_per_carton: "3" },
        { ...tile, sku: "T-5", unit: "sq yd", price: "9999999999.99", cost: "1" },
        { ...tile, sku: "T-6", sq_ft_per_carton: "0", price: "1", cost: "1" },
      ],
      contextFor({ suppliers: [SUPPLIER] }),
    );
    expect(problemsOf(result)).toEqual([
      "create",
      "price: Price is too large once converted to a price per sq ft.",
      "cost: Cost is too large once converted to a price per sq ft.",
      "create",
      "create",
      "sq_ft_per_carton: Sq ft per carton must be more than 0.",
    ]);
    expect(dec((result.changes[0]!.after as Product).price).eq(5000)).toBe(true);
    for (const change of result.changes) {
      const { price, cost } = change.after as Product;
      expect(price).toMatch(/^\d{1,10}(\.\d{1,4})?$/);
      expect(cost).toMatch(/^\d{1,10}(\.\d{1,4})?$/);
    }
  });

  it("SR-23 needs coverage for a carton product in every category, adhesives and trims included", () => {
    const result = plan(
      "products",
      [
        {
          sku: "AD-9",
          name: "Glue",
          category: "Adhesives and trims",
          unit: "cartons",
          price: "10",
          cost: "5",
          supplier: SUPPLIER.name,
        },
      ],
      contextFor({ suppliers: [SUPPLIER] }),
    );
    expect(problemsOf(result)).toEqual(["sq_ft_per_carton: Products sold by the carton need the sq ft per carton."]);
  });
});

describe("SR-24 to SR-27: the plan, its fingerprint, blank rows and hidden columns", () => {
  it("SR-24 leaves the caller's supplier contacts alone on a dry run", () => {
    const supplierContacts: SupplierContact[] = [];
    const ctx = contextFor({ supplierContacts });
    const result = plan(
      "suppliers",
      [{ name: "New Supply", email: "orders@new.example", contact_name: "Morgan Hale" }],
      ctx,
    );
    expect(result.changes.map((c) => c.collection)).toEqual(["suppliers", "supplierContacts"]);
    expect(ctx.world.supplierContacts).toBe(supplierContacts);
    expect(supplierContacts).toEqual([]);
  });

  it("SR-25 prints one letter per row, in row order", () => {
    const ctx = contextFor({
      customers: [customer({ externalId: "C-1", phone: "1" }), customer({ externalId: "C-2", name: "Kept" })],
    });
    const result = plan(
      "customers",
      [
        { external_id: "C-9", name: "New" },
        { external_id: "C-1", name: "Avery Collins", phone: "2" },
        { external_id: "C-2", name: "Kept" },
        { external_id: "C-3", name: "Bad", email: "nope" },
      ],
      ctx,
    );
    expect(planActions(result.rows)).toBe("cuse");
  });

  it("SR-26 leaves out a row blank in every chosen column, keeping the next row's number", () => {
    const def = importKind("customers");
    const request = {
      kind: "customers" as const,
      fileName: "c.csv",
      table: {
        headers: ["Name", "Email", "Notes"],
        rows: [
          ["A", "a@x.example", ""],
          ["", "  ", "only a note"],
          ["B", "b@x.example", ""],
        ],
      },
      mapping: autoMap(def, ["Name", "Email"]),
    };
    const result = planImport(IMPORT_HANDLERS.customers, request, contextFor());
    expect(result.rows.map((r) => [r.line, r.label])).toEqual([
      [2, "A"],
      [4, "B"],
    ]);
  });

  it("SR-27 never auto-maps a sensitive column the person can't use", () => {
    const def = importKind("customers");
    const headers = def.fields.map((f) => f.label);
    const mapping = autoMap(def, headers, { credit_limit: "Credit limit" }, new Set(["credit_limit"]));
    expect(mapping.credit_limit).toBeNull();
    expect(mapping.name).toBe("Name");
    const billsOnly = new Set<PermissionKey>(["purchasing.bill.view"]);
    expect(hiddenSensitiveFields("suppliers", (key) => billsOnly.has(key))).toEqual(new Set(["credit_limit"]));
    expect(hiddenSensitiveFields("suppliers", () => true)).toEqual(new Set());
    expect(hiddenSensitiveFields("addresses", () => false)).toEqual(new Set());
  });
});

describe("SR-28: an Undo never puts back what stock is valued at (ADR 0057 S-5, M4, M6)", () => {
  const before = product({ id: "prd-undo", sku: "LV-9", cost: "3.4000", supplierId: "sup-old" });
  const change = (after: Partial<Product>): ImportChange => ({
    collection: "products",
    id: before.id,
    before,
    after: { ...before, ...after },
  });
  const facts = (withStock: boolean, liveSuppliers: readonly string[] = ["sup-old", "sup-new"]) => ({
    hasStock: (id: string) => withStock && id === before.id,
    supplierLive: (id: string) => liveSuppliers.includes(id),
  });
  const FROZEN =
    "LV-9 has stock history now, so its cost, category, selling unit, coverage and roll width can't be put back.";

  it("refuses to put back a cost, category, unit, coverage or width once the product has stock history", () => {
    for (const after of [
      { cost: "3.9000" },
      { category: "carpet" as const },
      { unit: "each" as const },
      { sqFtPerCarton: "20.000" },
      { widthFt: 12 },
    ]) {
      expect(productUndoProblem(change(after), facts(true))).toBe(FROZEN);
      expect(productUndoProblem(change(after), facts(false))).toBeNull();
    }
    // The same number written another way, or a name change, is not a valuation change.
    expect(productUndoProblem(change({ cost: "3.4", name: "Renamed" }), facts(true))).toBeNull();
  });

  it("refuses when the earlier supplier is gone, and leaves created records and other kinds to the reference check", () => {
    expect(productUndoProblem(change({ supplierId: "sup-new" }), facts(false, ["sup-new"]))).toBe(
      "LV-9's earlier supplier was removed, so the import cannot be undone.",
    );
    expect(productUndoProblem(change({ supplierId: "sup-new" }), facts(false))).toBeNull();
    const created: ImportChange = { collection: "products", id: before.id, before: null, after: before };
    expect(productUndoProblem(created, facts(true, []))).toBeNull();
    const customerChange: ImportChange = { collection: "customers", id: "c-1", before: customer(), after: customer() };
    expect(productUndoProblem(customerChange, facts(true, []))).toBeNull();
  });
});
