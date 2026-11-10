import { CATEGORY_LABELS } from "../../catalog-labels";
import { SUPPLIER_TERMS_LABELS } from "../../operations/purchasing";
import { SUPPLIER_TYPE_LABELS } from "../../suppliers";
import type { ProductCategory, Supplier, SupplierContact, SupplierTerms, SupplierType } from "../../types";
import { addressFields, findParty, patched, rowAddress, text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome } from "../plan";

const NO_ADDRESS = { street: "", city: "", state: "", zip: "" };

/**
 * Suppliers (spec G1, D3): matched on external ID, then email, then the exact name, since a
 * company has few suppliers and often no ids for them. An update changes only the cells given.
 */
function resolveSupplier(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const place = rowAddress(row);
  if ("error" in place) return { problems: [{ field: place.field, message: place.error }] };
  const name = text(row, "name");
  const existing = findParty(ctx.world.suppliers, text(row, "external_id") || text(row, "email") || name);
  if (!existing) {
    const supplier: Supplier = {
      id: ctx.newId("sup"),
      externalId: text(row, "external_id") || undefined,
      name,
      type: (row.type as SupplierType | null) ?? "goods",
      status: "active",
      accountNumber: text(row, "account_number"),
      email: text(row, "email"),
      phone: text(row, "phone"),
      terms: (row.terms as SupplierTerms | null) ?? "net_30",
      creditLimit: text(row, "credit_limit", "0.00"),
      categories: (row.categories as ProductCategory[] | null) ?? [],
      address: place.address ?? NO_ADDRESS,
      track1099: false,
      taxForm: null,
      notes: "",
    };
    const contactName = text(row, "contact_name");
    const contact: SupplierContact | null = contactName
      ? {
          id: ctx.newId("con"),
          supplierId: supplier.id,
          name: contactName,
          role: "sales_rep",
          mobile: "",
          officePhone: supplier.phone,
          email: supplier.email,
          whatsapp: false,
          preferredMethod: "email",
          notes: "",
          isPrimary: true,
          status: "active",
        }
      : null;
    return {
      action: "create",
      label: name,
      writes: [
        { collection: "suppliers", record: supplier },
        ...(contact ? [{ collection: "supplierContacts" as const, record: contact }] : []),
      ],
    };
  }
  const next = patched(existing, {
    externalId: text(row, "external_id") || undefined,
    name,
    type: row.type as SupplierType | null,
    accountNumber: row.account_number as string | null,
    email: row.email as string | null,
    phone: row.phone as string | null,
    terms: row.terms as SupplierTerms | null,
    creditLimit: row.credit_limit as string | null,
    categories: row.categories as ProductCategory[] | null,
    address: place.address,
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
        aliases: ["account", "account no", "our account"],
        examples: ["AC-10021", ""],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        aliases: ["supplier", "supplier name", "vendor", "vendor name"],
        examples: ["Ridgeway Flooring Supply", "Cobalt Trim Works"],
      },
      {
        key: "contact_name",
        label: "Contact",
        type: "text",
        aliases: ["contact name", "rep"],
        examples: ["Morgan Hale", "Sam Ito"],
      },
      {
        key: "email",
        label: "Email",
        type: "email",
        aliases: ["email address"],
        examples: ["orders@ridgeway.example", "sales@cobalttrim.example"],
      },
      {
        key: "phone",
        label: "Phone",
        type: "text",
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
