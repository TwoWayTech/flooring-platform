import { ADDRESS_LABELS } from "../../customers";
import { PAYMENT_TERM_LABELS } from "../../operations/quotes";
import type { Customer, CustomerAddressLabel, CustomerType, PaymentTerms } from "../../types";
import { fold } from "../fields";
import type { Found } from "../lookups";
import {
  addressFields,
  ambiguous,
  findParty,
  findUser,
  keepStored,
  ownerOf,
  patched,
  rowAddress,
  text,
} from "../lookup";
import type { KindContext, KindHandler, ParsedRow, RowOutcome } from "../plan";
import type { CellProblem, ImportUser } from "../types";

const CUSTOMER_TYPES: Record<CustomerType, string> = {
  homeowner: "Homeowner",
  dealer: "Dealer",
  contractor: "Contractor",
};

/** The sales route's own cap (`addresses.max(50)`, sales.controller.ts), kept by both kinds (ADR 0057 S-12). */
const MAX_ADDRESSES = 50;
const TOO_MANY_ADDRESSES: CellProblem = {
  field: "street",
  message: `A customer can have at most ${MAX_ADDRESSES} addresses.`,
};

const refuse = (field: string, message: string): RowOutcome => ({ problems: [{ field, message }] });

/**
 * The customer a row names by its external ID, then its email (spec G1 matching). A key that
 * matches several customers is refused, never resolved to the first (ADR 0057 S-16).
 */
function matchCustomer(row: ParsedRow, ctx: KindContext): { customer?: Customer } | { problem: CellProblem } {
  const { customers } = ctx.lookups;
  const ext = text(row, "external_id");
  const email = text(row, "email");
  const byExt: Found<Customer> = ext ? customers.byExternalId(ext) : { none: true };
  if ("one" in byExt) return { customer: byExt.one };
  if ("many" in byExt) {
    const message = `${byExt.many} customers have the External ID “${ext}”. Fix them in the app first.`;
    return { problem: { field: "external_id", message } };
  }
  const byEmail: Found<Customer> = email ? customers.byEmail(email) : { none: true };
  if ("one" in byEmail) return { customer: byEmail.one };
  if ("many" in byEmail) {
    const message = `${byEmail.many} customers have the email “${email}”. Give an External ID instead.`;
    return { problem: { field: "email", message } };
  }
  return {};
}

/**
 * The sales rep a row names, by email then name: one active user (ADR 0057 S-8, S-16), or null
 * when the cell is empty.
 */
function matchRep(row: ParsedRow, ctx: KindContext): { rep: ImportUser | null } | { problem: CellProblem } {
  const key = text(row, "sales_rep");
  if (!key) return { rep: null };
  const found = findUser(ctx.lookups.users, key);
  if ("none" in found) return { problem: { field: "sales_rep", message: `No user matches “${key}”.` } };
  if ("many" in found) {
    return { problem: { field: "sales_rep", message: ambiguous(found.many, "users", key, "Use their email.") } };
  }
  // A rep moves the customer's "own" data scope and the branch of later invoices, so only an active user (S-8).
  if (found.one.status !== "active") {
    return { problem: { field: "sales_rep", message: `${found.one.name} is not an active user.` } };
  }
  return { rep: found.one };
}

/**
 * Customers (spec G1): matched on external ID, then email, so one of them is required. A new
 * customer gets the row's billing address, if any, and Due on receipt unless the row gives terms
 * (ADR 0057 S-9: never the company default, which may be looser); an update changes only the
 * cells given and adds the address when the customer does not have it yet.
 */
function resolveCustomer(row: ParsedRow, ctx: KindContext): RowOutcome {
  if (!text(row, "external_id") && !text(row, "email")) {
    return refuse("email", "Give an External ID or an Email, so a second import updates the customer.");
  }
  const rep = matchRep(row, ctx);
  if ("problem" in rep) return { problems: [rep.problem] };
  const place = rowAddress(row);
  if ("error" in place) return refuse(place.field, place.error);
  const match = matchCustomer(row, ctx);
  if ("problem" in match) return { problems: [match.problem] };
  const existing = match.customer;
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
      salesRepId: (rep.rep ?? ownerOf(ctx)).id,
      createdAt: ctx.today,
    };
    return { action: "create", label: name, writes: [{ collection: "customers", record: customer }] };
  }
  const known = place.address && existing.addresses.some((a) => sameAddress(a, place.address!));
  const addressId = place.address && !known ? ctx.newId("adr") : null;
  if (addressId && existing.addresses.length >= MAX_ADDRESSES) return { problems: [TOO_MANY_ADDRESSES] };
  const next = patched(existing, {
    externalId: text(row, "external_id") || undefined,
    type: row.type as CustomerType | null,
    name,
    contactName: row.contact_name as string | null,
    email: row.email as string | null,
    phone: row.phone as string | null,
    terms: row.terms as PaymentTerms | null,
    creditLimit: keepStored(existing.creditLimit, row.credit_limit as string | null),
    salesRepId: rep.rep?.id,
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
 * it the default billing or job-site address. A name several customers share is refused
 * (ADR 0057 S-16), and a customer keeps at most 50 addresses.
 */
function resolveAddress(row: ParsedRow, ctx: KindContext): RowOutcome {
  const key = text(row, "customer");
  const found = findParty(ctx.lookups.customers, key);
  if ("none" in found) {
    return refuse("customer", `No customer matches “${key}”. Use their External ID, email or exact name.`);
  }
  if ("many" in found) {
    return refuse("customer", ambiguous(found.many, "customers", key, "Use their External ID or email."));
  }
  const customer = found.one;
  const place = rowAddress(row);
  if ("error" in place) return refuse(place.field, place.error);
  const address = place.address!;
  const labelOf = (row.label as CustomerAddressLabel | null) ?? "job_site";
  const existing = customer.addresses.find((a) => sameAddress(a, address));
  if (!existing && customer.addresses.length >= MAX_ADDRESSES) return { problems: [TOO_MANY_ADDRESSES] };
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
        maxLength: 100,
        aliases: ["id", "customer id", "account number", "customer number"],
        examples: ["CUST-1001", "CUST-1002"],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        maxLength: 200,
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
        maxLength: 200,
        aliases: ["contact name", "contact person"],
        examples: ["Jordan Reyes", "Avery Collins"],
      },
      {
        key: "email",
        label: "Email",
        type: "email",
        maxLength: 320,
        aliases: ["email address", "e mail"],
        examples: ["orders@maplerow.example", "avery.collins@mail.example"],
      },
      {
        key: "phone",
        label: "Phone",
        type: "text",
        maxLength: 50,
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
        maxLength: 320,
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
