import { ADDRESS_LABELS } from "../../customers";
import { PAYMENT_TERM_LABELS } from "../../operations/quotes";
import type { Customer, CustomerAddressLabel, CustomerType, PaymentTerms } from "../../types";
import { fold } from "../fields";
import { addressFields, findParty, findUser, ownerOf, patched, rowAddress, text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome } from "../plan";

const CUSTOMER_TYPES: Record<CustomerType, string> = {
  homeowner: "Homeowner",
  dealer: "Dealer",
  contractor: "Contractor",
};

/** The customer a row names by its external ID or email (spec G1 matching). */
function matchCustomer(row: ParsedRow, ctx: PlanContext): Customer | undefined {
  const { customers } = ctx.world;
  const ext = text(row, "external_id");
  const email = text(row, "email");
  return (
    (ext ? customers.find((c) => c.externalId && fold(c.externalId) === fold(ext)) : undefined) ??
    (email ? customers.find((c) => c.email && fold(c.email) === email) : undefined)
  );
}

/**
 * Customers (spec G1): matched on external ID, then email, so one of them is required. A new
 * customer gets the row's billing address, if any; an update changes only the cells given and
 * adds the address when the customer does not have it yet.
 */
function resolveCustomer(row: ParsedRow, ctx: PlanContext): RowOutcome {
  if (!text(row, "external_id") && !text(row, "email")) {
    return {
      problems: [
        { field: "email", message: "Give an External ID or an Email, so a second import updates the customer." },
      ],
    };
  }
  const repKey = text(row, "sales_rep");
  const rep = repKey ? findUser(ctx.world.users, repKey) : undefined;
  if (repKey && !rep) return { problems: [{ field: "sales_rep", message: `No user matches “${repKey}”.` }] };
  const place = rowAddress(row);
  if ("error" in place) return { problems: [{ field: place.field, message: place.error }] };
  const existing = matchCustomer(row, ctx);
  const name = text(row, "name");
  if (!existing) {
    const addressId = place.address ? ctx.newId("adr") : null;
    const customer: Customer = {
      id: ctx.newId("cus"),
      externalId: text(row, "external_id") || undefined,
      type: (row.type as CustomerType | null) ?? "homeowner",
      name,
      contactName: text(row, "contact_name", name),
      email: text(row, "email"),
      phone: text(row, "phone"),
      addresses: place.address && addressId ? [{ id: addressId, label: "billing", ...place.address }] : [],
      defaultBillingId: addressId,
      defaultJobSiteId: null,
      terms: (row.terms as PaymentTerms | null) ?? "due_on_receipt",
      creditLimit: text(row, "credit_limit", "0.00"),
      taxExempt: false,
      certificate: null,
      salesRepId: (rep ?? ownerOf(ctx)).id,
      createdAt: ctx.today,
    };
    return { action: "create", label: name, writes: [{ collection: "customers", record: customer }] };
  }
  const known = place.address && existing.addresses.some((a) => sameAddress(a, place.address!));
  const addressId = place.address && !known ? ctx.newId("adr") : null;
  const next = patched(existing, {
    externalId: text(row, "external_id") || undefined,
    type: row.type as CustomerType | null,
    name,
    contactName: row.contact_name as string | null,
    email: row.email as string | null,
    phone: row.phone as string | null,
    terms: row.terms as PaymentTerms | null,
    creditLimit: row.credit_limit as string | null,
    salesRepId: rep?.id,
    ...(addressId && place.address
      ? {
          addresses: [...existing.addresses, { id: addressId, label: "billing" as const, ...place.address }],
          defaultBillingId: existing.defaultBillingId ?? addressId,
        }
      : {}),
  });
  if (!next) return { action: "skip", label: name, writes: [], note: "Nothing changed." };
  return { action: "update", label: name, writes: [{ collection: "customers", record: next }] };
}

/** Two addresses are the same place when street and ZIP match, ignoring case and spacing. */
const sameAddress = (a: { street: string; zip: string }, b: { street: string; zip: string }) =>
  fold(a.street) === fold(b.street) && a.zip === b.zip;

/**
 * Customer addresses (spec G1, A6): each row adds an address to the customer it names (external
 * ID, email or exact name), or updates the one already at that street and ZIP. "Default" makes
 * it the default billing or job-site address.
 */
function resolveAddress(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const key = text(row, "customer");
  const customer = findParty(ctx.world.customers, key);
  if (!customer) {
    return {
      problems: [
        { field: "customer", message: `No customer matches “${key}”. Use their External ID, email or exact name.` },
      ],
    };
  }
  const place = rowAddress(row);
  if ("error" in place) return { problems: [{ field: place.field, message: place.error }] };
  const address = place.address!;
  const labelOf = (row.label as CustomerAddressLabel | null) ?? "job_site";
  const existing = customer.addresses.find((a) => sameAddress(a, address));
  const id = existing?.id ?? ctx.newId("adr");
  const entry = { ...existing, id, label: labelOf, ...address };
  const addresses = existing
    ? customer.addresses.map((a) => (a.id === id ? entry : a))
    : [...customer.addresses, entry];
  const makeDefault = row.default === true;
  const next = patched(customer, {
    addresses,
    defaultBillingId:
      makeDefault && labelOf === "billing" ? id : (customer.defaultBillingId ?? (labelOf === "billing" ? id : null)),
    defaultJobSiteId:
      makeDefault && labelOf === "job_site" ? id : (customer.defaultJobSiteId ?? (labelOf === "job_site" ? id : null)),
  });
  const label = `${customer.name}: ${address.street}`;
  if (!next) return { action: "skip", label, writes: [], note: "Already on file." };
  return { action: existing ? "update" : "create", label, writes: [{ collection: "customers", record: next }] };
}

/** The customers kind. */
export const CUSTOMERS: KindHandler = {
  labelField: "name",
  duplicateKey: (row) =>
    text(row, "external_id") || text(row, "email") ? `${text(row, "external_id")}|${text(row, "email")}` : null,
  resolve: resolveCustomer,
  def: {
    kind: "customers",
    label: "Customers",
    description: "Accounts with contact details, terms, credit limit and a billing address.",
    module: "core",
    matchOn: "External ID, then email",
    fields: [
      {
        key: "external_id",
        label: "External ID",
        type: "text",
        aliases: ["id", "customer id", "account number", "customer number"],
        examples: ["CUST-1001", "CUST-1002"],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        aliases: ["customer", "customer name", "account name", "company"],
        examples: ["Maple Row Builders", "Avery Collins"],
      },
      {
        key: "type",
        label: "Type",
        type: "choice",
        choices: CUSTOMER_TYPES,
        aliases: ["customer type"],
        examples: ["Contractor", "Homeowner"],
      },
      {
        key: "contact_name",
        label: "Contact",
        type: "text",
        aliases: ["contact name", "contact person"],
        examples: ["Jordan Reyes", "Avery Collins"],
      },
      {
        key: "email",
        label: "Email",
        type: "email",
        aliases: ["email address", "e mail"],
        examples: ["orders@maplerow.example", "avery.collins@mail.example"],
      },
      {
        key: "phone",
        label: "Phone",
        type: "text",
        aliases: ["phone number", "telephone", "tel"],
        examples: ["(303) 555-0142", "(720) 555-0188"],
      },
      {
        key: "terms",
        label: "Payment terms",
        type: "choice",
        choices: PAYMENT_TERM_LABELS,
        aliases: ["terms"],
        examples: ["Net 30", "Due on receipt"],
      },
      {
        key: "credit_limit",
        label: "Credit limit",
        type: "money",
        aliases: ["credit"],
        examples: ["25000.00", "0.00"],
      },
      {
        key: "sales_rep",
        label: "Sales rep",
        type: "text",
        aliases: ["rep", "salesperson", "sales person"],
        examples: ["", ""],
      },
      ...addressFields(false),
    ],
  },
};

/** The customer addresses kind. */
export const ADDRESSES: KindHandler = {
  labelField: "street",
  duplicateKey: (row) => `${fold(text(row, "customer"))}|${fold(text(row, "street"))}|${text(row, "zip")}`,
  resolve: resolveAddress,
  def: {
    kind: "addresses",
    label: "Customer addresses",
    description: "Job sites, billing and delivery addresses for customers already in the app.",
    module: "core",
    matchOn: "the customer's External ID, email or name, then street and ZIP",
    fields: [
      {
        key: "customer",
        label: "Customer",
        type: "text",
        required: true,
        aliases: ["customer id", "customer email", "account", "external id"],
        examples: ["CUST-1001", "avery.collins@mail.example"],
      },
      {
        key: "label",
        label: "Address type",
        type: "choice",
        choices: ADDRESS_LABELS,
        aliases: ["type", "kind", "label"],
        examples: ["Job site", "Billing"],
      },
      ...addressFields(true),
      { key: "default", label: "Default", type: "bool", aliases: ["is default", "primary"], examples: ["yes", "no"] },
    ],
  },
};
