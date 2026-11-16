import { CATEGORY_LABELS } from "../../catalog-labels";
import { SUPPLIER_TERMS_LABELS } from "../../operations/purchasing";
import { contactProblem, SUPPLIER_TYPE_LABELS } from "../../suppliers";
import type { Address, ProductCategory, Supplier, SupplierContact, SupplierTerms, SupplierType } from "../../types";
import { fold } from "../fields";
import { addressFields, ambiguous, findParty, keepStored, patched, rowAddress, text } from "../lookup";
import type { KindContext, KindHandler, ParsedRow, RowOutcome } from "../plan";

const NO_ADDRESS = { street: "", city: "", state: "", zip: "" };
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as ProductCategory[];

const refuse = (field: string, message: string): RowOutcome => ({ problems: [{ field, message }] });

/** Categories in catalog order, so the same set is always stored the same way (ADR 0057 S-10). */
const inCatalogOrder = (categories: readonly ProductCategory[]) => CATEGORY_ORDER.filter((c) => categories.includes(c));

/** Whether two category lists hold the same set, in any order. */
const sameSet = (a: readonly ProductCategory[], b: readonly ProductCategory[]) =>
  new Set(a).size === new Set(b).size && a.every((c) => b.includes(c));

/**
 * The address an update writes (ADR 0057 S-10): none when the row gives none or the same place
 * (street and city folded, state and ZIP exact), else the row's four fields. The stored county
 * then goes, because it belonged to the old place.
 */
function addressChange(stored: Address, given: Address | null): Address | null {
  if (!given) return null;
  const same =
    fold(stored.street) === fold(given.street) &&
    fold(stored.city) === fold(given.city) &&
    stored.state === given.state &&
    stored.zip === given.zip;
  return same ? null : given;
}

/**
 * The primary contact a new supplier's Contact cell adds, reached by the supplier's email or
 * phone (ADR 0057 R3). It must pass the module's own contact rule, or the row is refused.
 */
function newContact(row: ParsedRow, ctx: KindContext, supplier: Supplier): SupplierContact | null | "invalid" {
  const name = text(row, "contact_name");
  if (!name) return null;
  const contact: SupplierContact = {
    id: ctx.newId("con"),
    supplierId: supplier.id,
    name,
    role: "sales_rep",
    mobile: "",
    officePhone: supplier.phone,
    email: supplier.email,
    whatsapp: false,
    preferredMethod: supplier.email ? "email" : "call",
    notes: "",
    isPrimary: true,
    status: "active",
  };
  return contactProblem(contact) ? "invalid" : contact;
}

/**
 * Suppliers (spec G1, D3): matched on external ID, then email, then the exact name, since a
 * company has few suppliers and often no ids for them. A key several suppliers share is refused
 * (ADR 0057 S-16). A new supplier without terms pays on order, the purchasing module's safe
 * default (ADR 0057 S-9). An update changes only the cells given.
 */
function resolveSupplier(row: ParsedRow, ctx: KindContext): RowOutcome {
  const place = rowAddress(row);
  if ("error" in place) return refuse(place.field, place.error);
  const name = text(row, "name");
  const ext = text(row, "external_id");
  const email = text(row, "email");
  const key = ext || email || name;
  const found = findParty(ctx.lookups.suppliers, key);
  if ("many" in found) {
    const field = ext ? "external_id" : email ? "email" : "name";
    return refuse(field, ambiguous(found.many, "suppliers", key, "Use their External ID or email."));
  }
  const categories = row.categories as ProductCategory[] | null;
  if ("none" in found) {
    const supplier: Supplier = {
      id: ctx.newId("sup"),
      externalId: ext || undefined,
      name,
      type: (row.type as SupplierType | null) ?? "goods",
      status: "active",
      accountNumber: text(row, "account_number"),
      email,
      phone: text(row, "phone"),
      terms: (row.terms as SupplierTerms | null) ?? "pay_on_order",
      creditLimit: text(row, "credit_limit", "0.00"),
      categories: inCatalogOrder(categories ?? []),
      address: place.address ?? NO_ADDRESS,
      track1099: false,
      taxForm: null,
      notes: "",
    };
    const contact = newContact(row, ctx, supplier);
    if (contact === "invalid") {
      return refuse(
        "contact_name",
        "A contact needs the supplier's Email or Phone on the same row, or leave Contact empty.",
      );
    }
    return {
      action: "create",
      label: name,
      writes: [
        { collection: "suppliers", record: supplier },
        ...(contact ? [{ collection: "supplierContacts" as const, record: contact }] : []),
      ],
    };
  }
  const existing = found.one;
  const next = patched(existing, {
    externalId: ext || undefined,
    name,
    type: row.type as SupplierType | null,
    accountNumber: row.account_number as string | null,
    email: row.email as string | null,
    phone: row.phone as string | null,
    terms: row.terms as SupplierTerms | null,
    creditLimit: keepStored(existing.creditLimit, row.credit_limit as string | null),
    categories: categories && !sameSet(categories, existing.categories) ? inCatalogOrder(categories) : null,
    address: addressChange(existing.address, place.address),
  });
  if (!next) return { action: "skip", label: name, writes: [], note: "Nothing changed." };
  return { action: "update", label: name, writes: [{ collection: "suppliers", record: next }] };
}

/** The suppliers kind. */
export const SUPPLIERS: KindHandler = {
  labelField: "name",
  duplicateKey: (row) => (text(row, "external_id") || text(row, "email") || text(row, "name")).toLowerCase(),
  resolve: resolveSupplier,
  def: {
    kind: "suppliers",
    label: "Suppliers",
    description: "Vendors with terms, credit limit and the categories they supply.",
    module: "core",
    matchOn: "External ID, then email, then name",
    fields: [
      {
        key: "external_id",
        label: "External ID",
        type: "text",
        maxLength: 100,
        aliases: ["id", "supplier id", "vendor id", "vendor number"],
        examples: ["VEN-201", "VEN-202"],
      },
      {
        key: "type",
        label: "Type",
        type: "choice",
        choices: SUPPLIER_TYPE_LABELS,
        aliases: ["vendor type", "supplier type"],
        examples: ["Goods", "Services"],
      },
      {
        key: "account_number",
        label: "Account number",
        type: "text",
        maxLength: 100,
        aliases: ["account", "account no", "our account"],
        examples: ["AC-10021", ""],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        maxLength: 200,
        aliases: ["supplier", "supplier name", "vendor", "vendor name"],
        examples: ["Ridgeway Flooring Supply", "Cobalt Trim Works"],
      },
      {
        key: "contact_name",
        label: "Contact",
        type: "text",
        maxLength: 200,
        aliases: ["contact name", "rep"],
        examples: ["Morgan Hale", "Sam Ito"],
      },
      {
        key: "email",
        label: "Email",
        type: "email",
        maxLength: 320,
        aliases: ["email address"],
        examples: ["orders@ridgeway.example", "sales@cobalttrim.example"],
      },
      {
        key: "phone",
        label: "Phone",
        type: "text",
        maxLength: 50,
        aliases: ["phone number", "telephone"],
        examples: ["(303) 555-0110", "(719) 555-0175"],
      },
      {
        key: "terms",
        label: "Terms",
        type: "choice",
        choices: SUPPLIER_TERMS_LABELS,
        aliases: ["payment terms"],
        examples: ["Net 30", "Monthly statement"],
      },
      {
        key: "credit_limit",
        label: "Credit limit",
        type: "money",
        aliases: ["credit"],
        examples: ["50000.00", "10000.00"],
      },
      {
        key: "categories",
        label: "Categories",
        type: "list",
        choices: CATEGORY_LABELS,
        aliases: ["category", "product categories"],
        examples: ["Carpet; LVP and LVT", "Adhesives and trims"],
      },
      ...addressFields(false),
    ],
  },
};
