import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  ALL_PERMISSION_KEYS,
  type Customer,
  type ImportChange,
  type PermissionKey,
  type Product,
  type Supplier,
  type SupplierContact,
} from "@workspace/shared";
import { describe, expect, it } from "vitest";
import { addressRow, CUSTOMER_STORE, customerRow } from "../src/modules/imports/customer-store";
import { openColumns, openKind, openKinds, SERVER_IMPORT_KINDS } from "../src/modules/imports/import-access";
import { batchEntry, mappingEntry, recordEntry, undoRecordEntry } from "../src/modules/imports/import-audit";
import { summaryOf } from "../src/modules/imports/import-records";
import { PRODUCT_STORE, productRow } from "../src/modules/imports/product-store";
import { contactRow, SUPPLIER_STORE, supplierRow } from "../src/modules/imports/supplier-store";

const CUSTOMER: Customer = {
  id: "0190f6a2-0000-7000-8000-0000000000c1",
  type: "contractor",
  name: "Maple Row Builders",
  contactName: "Jordan Reyes",
  email: "orders@maplerow.example",
  phone: "(303) 555-0142",
  addresses: [
    {
      id: "0190f6a2-0000-7000-8000-0000000000a1",
      label: "billing",
      street: "4870 Quarry Lane",
      city: "Denver",
      state: "CO",
      zip: "80216",
      county: "Denver",
    },
  ],
  defaultBillingId: "0190f6a2-0000-7000-8000-0000000000a1",
  defaultJobSiteId: null,
  terms: "net_30",
  creditLimit: "25000.00",
  taxExempt: false,
  certificate: null,
  salesRepId: "",
  createdAt: "2026-11-16",
};

const SUPPLIER: Supplier = {
  id: "0190f6a2-0000-7000-8000-0000000000s1",
  name: "Ridgeway Flooring Supply",
  type: "goods",
  status: "active",
  accountNumber: "AC-10021",
  email: "orders@ridgeway.example",
  phone: "(303) 555-0110",
  terms: "net_30",
  creditLimit: "50000.00",
  categories: ["carpet", "lvp"],
  address: { street: "1 Mill Road", city: "Denver", state: "CO", zip: "80216" },
  track1099: false,
  taxForm: null,
  notes: "",
};

const CONTACT: SupplierContact = {
  id: "0190f6a2-0000-7000-8000-0000000000k1",
  supplierId: SUPPLIER.id,
  name: "Morgan Hale",
  role: "sales_rep",
  mobile: "",
  officePhone: "(303) 555-0110",
  email: "orders@ridgeway.example",
  whatsapp: false,
  preferredMethod: "email",
  notes: "",
  isPrimary: true,
  status: "active",
};

const PRODUCT: Product = {
  id: "0190f6a2-0000-7000-8000-0000000000p1",
  sku: "RW-5001",
  name: "Harbor Oak Wide Plank",
  brand: "Ridgeway",
  collection: "Coastline",
  colorName: "Harbor Oak",
  swatch: "#A39A8E",
  category: "lvp",
  unit: "sq_ft",
  price: "3.4000",
  cost: "2.1000",
  attributes: {},
  supplierId: "",
  createdAt: "2026-11-16T09:00",
};

describe("U-6 row functions", () => {
  it("customerRow writes exactly the import's columns, with no rep and no external ID as null", () => {
    const row = customerRow(CUSTOMER);
    expect(Object.keys(row).sort()).toEqual(
      [
        "type",
        "name",
        "contactName",
        "email",
        "phone",
        "terms",
        "creditLimit",
        "salesRepId",
        "externalId",
        "defaultBillingId",
        "defaultJobSiteId",
      ].sort(),
    );
    expect(row.salesRepId).toBeNull();
    expect(row.externalId).toBeNull();
    expect(customerRow({ ...CUSTOMER, salesRepId: "u1", externalId: "CUST-9001" })).toMatchObject({
      salesRepId: "u1",
      externalId: "CUST-9001",
    });
  });

  it("addressRow never writes the county or coordinates", () => {
    expect(addressRow({ ...CUSTOMER.addresses[0]!, lat: 39.7, lng: -104.9 })).toEqual({
      label: "billing",
      street: "4870 Quarry Lane",
      city: "Denver",
      state: "CO",
      zip: "80216",
    });
  });

  it("supplierRow writes exactly the import's columns", () => {
    const row = supplierRow(SUPPLIER);
    expect(Object.keys(row).sort()).toEqual(
      [
        "name",
        "type",
        "accountNumber",
        "email",
        "phone",
        "terms",
        "creditLimit",
        "categories",
        "address",
        "externalId",
      ].sort(),
    );
    expect(row.externalId).toBeNull();
  });

  it("contactRow writes the contact as built", () => {
    expect(Object.keys(contactRow(CONTACT)).sort()).toEqual(Object.keys(CONTACT).sort());
  });

  it("productRow maps no supplier, coverage, width or reorder point to null, and numbers to text", () => {
    const row = productRow(PRODUCT);
    expect(Object.keys(row).sort()).toEqual(
      [
        "name",
        "brand",
        "collection",
        "colorName",
        "category",
        "unit",
        "price",
        "cost",
        "sqFtPerCarton",
        "reorderPoint",
        "widthFt",
        "supplierId",
      ].sort(),
    );
    expect(row).toMatchObject({ supplierId: null, sqFtPerCarton: null, widthFt: null, reorderPoint: null });
    expect(productRow({ ...PRODUCT, widthFt: 12.5, reorderPoint: 40, sqFtPerCarton: "23.640" })).toMatchObject({
      widthFt: "12.5",
      reorderPoint: "40",
      sqFtPerCarton: "23.640",
    });
  });
});

describe("the stores", () => {
  it("name and target their records as the modules do", () => {
    expect(CUSTOMER_STORE.record("customers")).toEqual({
      noun: "customer",
      targetType: "customer",
      table: "customers",
    });
    expect(SUPPLIER_STORE.record("supplierContacts")).toEqual({
      noun: "supplier contact",
      targetType: "supplier_contact",
      table: "supplier_contacts",
    });
    expect(PRODUCT_STORE.record("products").table).toBe("products");
  });

  it("count a customer's new addresses as created parts", () => {
    const added = {
      id: "0190f6a2-0000-7000-8000-0000000000a2",
      label: "job_site" as const,
      street: "9 Elm",
      city: "Denver",
      state: "CO",
      zip: "80202",
    };
    const update: ImportChange = {
      collection: "customers",
      id: CUSTOMER.id,
      before: CUSTOMER,
      after: { ...CUSTOMER, addresses: [...CUSTOMER.addresses, added] },
    };
    expect(CUSTOMER_STORE.createdParts(update)).toEqual([{ table: "addresses", id: added.id }]);
    const create: ImportChange = { collection: "customers", id: CUSTOMER.id, before: null, after: CUSTOMER };
    expect(CUSTOMER_STORE.createdParts(create)).toEqual([{ table: "addresses", id: CUSTOMER.addresses[0]!.id }]);
  });
});

describe("audit entries", () => {
  const created: ImportChange = { collection: "customers", id: CUSTOMER.id, before: null, after: CUSTOMER };
  const updated: ImportChange = {
    collection: "customers",
    id: CUSTOMER.id,
    before: CUSTOMER,
    after: { ...CUSTOMER, phone: "(303) 555-0199" },
  };

  it("name each record and its batch, with sensitive values under their own names", () => {
    expect(recordEntry(CUSTOMER_STORE, created, "IMP-1001")).toMatchObject({
      category: "data",
      action: "Imported customer",
      targetType: "customer",
      targetId: CUSTOMER.id,
      targetLabel: "Maple Row Builders",
      before: null,
      after: { creditLimit: "25000.00", salesRepId: null, externalId: null, batch: "IMP-1001" },
    });
    expect(recordEntry(CUSTOMER_STORE, updated, "IMP-1002")).toMatchObject({
      action: "Updated customer by import",
      before: { phone: "(303) 555-0142" },
      after: { phone: "(303) 555-0199", batch: "IMP-1002" },
    });
  });

  it("word an Undo per record", () => {
    expect(undoRecordEntry(CUSTOMER_STORE, created, "IMP-1001")).toMatchObject({
      action: "Removed imported customer",
      after: { batch: "IMP-1001" },
    });
    expect(undoRecordEntry(CUSTOMER_STORE, updated, "IMP-1002")).toMatchObject({
      action: "Restored customer after undoing an import",
      before: { phone: "(303) 555-0199" },
      after: { phone: "(303) 555-0142", batch: "IMP-1002" },
    });
    expect(
      undoRecordEntry(
        PRODUCT_STORE,
        { collection: "products", id: PRODUCT.id, before: null, after: PRODUCT },
        "IMP-1003",
      ),
    ).toMatchObject({
      action: "Removed imported product",
      before: { sku: "RW-5001", cost: "2.1000", supplierId: null },
    });
  });

  it("word the batch and saved columns as the spec and ADR 0057 do", () => {
    const counts = { create: 2, update: 0, skip: 0, error: 1 };
    expect(batchEntry({ id: "b1", number: "IMP-1001", kind: "addresses", fileName: "sites.csv", counts })).toEqual({
      category: "data",
      action: "Imported customer addresses",
      targetType: "import_job",
      targetId: "b1",
      targetLabel: "IMP-1001, sites.csv",
      before: null,
      after: "2 created, 0 updated, 0 skipped, 1 with errors",
    });
    expect(mappingEntry({ id: "m1", kind: "suppliers", columns: { name: "Vendor" } }, null)).toMatchObject({
      action: "Saved import columns",
      targetType: "import_mapping",
      targetLabel: "Suppliers",
      before: null,
      after: { name: "Vendor" },
    });
  });
});

describe("batch summaries", () => {
  it("never carry the saved records, and name a gone sign-in Former user", () => {
    const at = new Date("2026-11-16T07:30:00Z");
    const stored = {
      id: "b1",
      number: "IMP-1001",
      kind: "customers" as const,
      fileName: "customers.csv",
      mapping: { name: "Name" },
      counts: { create: 1, update: 0, skip: 0, error: 0 },
      changes: [{ collection: "customers" as const, id: CUSTOMER.id, before: null, after: CUSTOMER }],
      createdAt: at,
      createdBy: "u1",
      undoneAt: at,
      undoneBy: "u2",
    };
    const summary = summaryOf(stored, new Map([["u1", "Sam Lee"]]));
    expect(summary).not.toHaveProperty("changes");
    expect(summary).toMatchObject({ at: at.toISOString(), byName: "Sam Lee", undoneBy: "Former user" });
  });
});

describe("access on the API", () => {
  const holder = (keys: readonly PermissionKey[], dataScope: "all" | "branch" = "all") => ({
    permissions: new Set(keys),
    dataScope,
    modules: ["core", "hr"] as const,
  });
  const everything = holder(ALL_PERMISSION_KEYS);

  it("runs part 1's four kinds and answers 404 for the rest", () => {
    expect([...SERVER_IMPORT_KINDS]).toEqual(["customers", "addresses", "suppliers", "products"]);
    expect(openKinds(everything)).toEqual(["customers", "addresses", "suppliers", "products"]);
    for (const kind of ["stock", "invoices", "bills", "employees", "timesheets"] as const) {
      expect(() => openKind(everything, kind)).toThrow(NotFoundException);
    }
  });

  it("refuses a narrow scope, a missing kind key and an unseen sensitive column with 403", () => {
    expect(() => openKind(holder(ALL_PERMISSION_KEYS, "branch"), "customers")).toThrow(ForbiddenException);
    const noView = ALL_PERMISSION_KEYS.filter((key) => key !== "customers.customer.view");
    expect(() => openKind(holder(noView), "customers")).toThrow(ForbiddenException);
    const noCredit = holder(ALL_PERMISSION_KEYS.filter((key) => key !== "customers.customer.view_sensitive"));
    expect(() => openColumns(noCredit, "customers", { credit_limit: "Credit" })).toThrow(ForbiddenException);
    expect(() => openColumns(noCredit, "customers", { credit_limit: null })).not.toThrow();
  });
});
