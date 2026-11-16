import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ADDRESS_LABELS,
  CATEGORY_LABELS,
  importKind,
  PAYMENT_TERM_LABELS,
  SUPPLIER_TERMS_LABELS,
  SUPPLIER_TYPE_LABELS,
  UNIT_LABELS,
  type Customer,
  type ImportKind,
  type ImportRequest,
  type Product,
  type Supplier,
  type SupplierContact,
} from "@workspace/shared";

/** The part of Summit Floor Co.'s demo data that the master-data import moves (ADR 0057 I-27). */
export interface SummitMasterData {
  suppliers: Supplier[];
  supplierContacts: SupplierContact[];
  products: Product[];
  customers: Customer[];
}

/** One file row: cells by the kind's field keys. */
export type ImportRow = Readonly<Record<string, string>>;

/** Summit's suppliers, contacts, products and customers as the demo fixture holds them. */
export function summitMasterData(): SummitMasterData {
  const file = createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as SummitMasterData;
  return {
    suppliers: data.suppliers,
    supplierContacts: data.supplierContacts,
    products: data.products,
    customers: data.customers,
  };
}

/**
 * A file as the web sends it (ADR 0057 S-15): only the chosen columns, in field order, each headed
 * by its field's label, and the mapping that names them. Each row gives cells by field key; a
 * field no row names is left out, and a key that is not a field of the kind is a mistake in the
 * test, so it throws.
 */
export function importFile(kind: ImportKind, rows: readonly ImportRow[], fileName = `${kind}.csv`): ImportRequest {
  const def = importKind(kind);
  const known = new Set(def.fields.map((field) => field.key));
  const unknown = rows.flatMap(Object.keys).find((key) => !known.has(key));
  if (unknown) throw new Error(`The ${kind} kind has no field “${unknown}”.`);
  const fields = def.fields.filter((field) => rows.some((row) => Object.hasOwn(row, field.key)));
  return {
    kind,
    fileName,
    table: {
      headers: fields.map((field) => field.label),
      rows: rows.map((row) => fields.map((field) => row[field.key] ?? "")),
    },
    mapping: Object.fromEntries(fields.map((field) => [field.key, field.label])),
  };
}

/** The four files of the week-19 gate, part 1, in the order they import. */
export interface SummitFiles {
  suppliers: ImportRequest;
  products: ImportRequest;
  customers: ImportRequest;
  addresses: ImportRequest;
}

/** Whether an address is the default its label can be (billing or job site), as the addresses kind marks it. */
function isDefault(customer: Customer, address: Customer["addresses"][number]): boolean {
  return (
    (address.label === "billing" && address.id === customer.defaultBillingId) ||
    (address.label === "job_site" && address.id === customer.defaultJobSiteId)
  );
}

/**
 * Summit's master data as the files a company would bring for the week-19 gate (ADR 0057 I-27):
 * suppliers with their primary contact, products naming their supplier, customers keyed by their
 * demo id as External ID, and every customer address with the default ones marked. Choices are
 * written as people write them (labels such as "Net 30" or "LVP and LVT").
 *
 * Left out on purpose: the sales rep, since Summit's users don't exist in a fresh company, and the
 * reorder point, since the fixture holds sq ft quantities such as 686.4 and the kind reads whole
 * numbers (import spec "Products" field table).
 */
export function summitFiles(data: SummitMasterData = summitMasterData()): SummitFiles {
  const contactOf = new Map(
    data.supplierContacts.filter((contact) => contact.isPrimary).map((contact) => [contact.supplierId, contact.name]),
  );
  const supplierName = new Map(data.suppliers.map((supplier) => [supplier.id, supplier.name]));
  return {
    suppliers: importFile(
      "suppliers",
      data.suppliers.map((s) => ({
        external_id: s.id,
        type: SUPPLIER_TYPE_LABELS[s.type],
        account_number: s.accountNumber,
        name: s.name,
        contact_name: contactOf.get(s.id) ?? "",
        email: s.email,
        phone: s.phone,
        terms: SUPPLIER_TERMS_LABELS[s.terms],
        credit_limit: s.creditLimit,
        categories: s.categories.map((category) => CATEGORY_LABELS[category]).join("; "),
        street: s.address.street,
        city: s.address.city,
        state: s.address.state,
        zip: s.address.zip,
      })),
    ),
    products: importFile(
      "products",
      data.products.map((p) => ({
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        collection: p.collection,
        color: p.colorName,
        category: CATEGORY_LABELS[p.category],
        unit: UNIT_LABELS[p.unit],
        price: p.price,
        cost: p.cost,
        sq_ft_per_carton: p.sqFtPerCarton ?? "",
        width_ft: p.widthFt === undefined ? "" : String(p.widthFt),
        supplier: supplierName.get(p.supplierId) ?? "",
      })),
    ),
    customers: importFile(
      "customers",
      data.customers.map((c) => ({
        external_id: c.id,
        name: c.name,
        type: c.type,
        contact_name: c.contactName,
        email: c.email,
        phone: c.phone,
        terms: PAYMENT_TERM_LABELS[c.terms],
        credit_limit: c.creditLimit,
      })),
    ),
    addresses: importFile(
      "addresses",
      data.customers.flatMap((c) =>
        c.addresses.map((a) => ({
          customer: c.id,
          label: ADDRESS_LABELS[a.label],
          street: a.street,
          city: a.city,
          state: a.state,
          zip: a.zip,
          default: isDefault(c, a) ? "yes" : "",
        })),
      ),
    ),
  };
}
