import type { ContactRole, Supplier, SupplierContact, SupplierType } from "./types";

/** Words for supplier types (spec B1). */
export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  goods: "Goods",
  services: "Services",
  utility: "Utility",
  government: "Government",
};

/** Words for a contact's role (spec B1). */
export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  sales_rep: "Sales rep",
  account_manager: "Account manager",
  accounts_receivable: "Accounts receivable",
  other: "Other",
};

const digits = (value: string) => value.replace(/\D/g, "");

/** A company name with case, punctuation and company suffixes removed, to spot duplicates (ADR 0022). */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|incorporated|llc|co|corp|corporation|company|ltd|limited)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** An active supplier that looks like the name being added; a warning, never a block (ADR 0022). */
export function findSimilarSupplier(name: string, suppliers: readonly Supplier[]): Supplier | undefined {
  const wanted = normalizeCompanyName(name);
  if (!wanted) return undefined;
  return suppliers.find((s) => s.status === "active" && normalizeCompanyName(s.name) === wanted);
}

/** What is missing from a supplier's profile; "profile incomplete" is derived from this, never stored. */
export function supplierProfileGaps(supplier: Supplier, contacts: readonly SupplierContact[]): string[] {
  const gaps: string[] = [];
  if (!supplier.address.street) gaps.push("an address");
  const reachable =
    !!supplier.email ||
    !!supplier.phone ||
    contacts.some(
      (c) => c.supplierId === supplier.id && c.status === "active" && (c.email || c.mobile || c.officePhone),
    );
  if (!reachable) gaps.push("a way to reach them");
  return gaps;
}

const ROLE_ORDER: Record<ContactRole, number> = { sales_rep: 0, account_manager: 1, other: 2, accounts_receivable: 3 };

/** A supplier's active contacts: primary first, then sales reps, account managers and others, accounts receivable last. */
export function contactsOf(supplierId: string, contacts: readonly SupplierContact[]): SupplierContact[] {
  return contacts
    .filter((c) => c.supplierId === supplierId && c.status === "active")
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        a.name.localeCompare(b.name),
    );
}

/** A supplier found by a search, and the contact that matched, if it was one of them. */
export interface SupplierMatch {
  supplier: Supplier;
  via: SupplierContact | null;
}

/** Whether one contact matches what was typed: name, email or phone digits. */
function contactMatches(contact: SupplierContact, query: string): boolean {
  const q = query.toLowerCase();
  const typed = digits(query);
  return (
    contact.name.toLowerCase().includes(q) ||
    contact.email.toLowerCase().includes(q) ||
    (typed.length >= 3 && (digits(contact.mobile).includes(typed) || digits(contact.officePhone).includes(typed)))
  );
}

/**
 * Finds active suppliers by name, account number, company phone or email, or by any of their
 * active contacts (spec B2). Phones match on digits only.
 */
export function searchSuppliers(
  query: string,
  suppliers: readonly Supplier[],
  contacts: readonly SupplierContact[],
): SupplierMatch[] {
  const active = suppliers.filter((s) => s.status === "active");
  const q = query.trim();
  if (!q) return active.map((supplier) => ({ supplier, via: null }));
  const lower = q.toLowerCase();
  const typed = digits(q);
  return active.flatMap((supplier): SupplierMatch[] => {
    const own =
      supplier.name.toLowerCase().includes(lower) ||
      supplier.accountNumber.toLowerCase().includes(lower) ||
      supplier.email.toLowerCase().includes(lower) ||
      (typed.length >= 3 && digits(supplier.phone).includes(typed));
    if (own) return [{ supplier, via: null }];
    const via = contactsOf(supplier.id, contacts).find((c) => contactMatches(c, q));
    return via ? [{ supplier, via }] : [];
  });
}

/** Why a contact cannot be saved, or null: a name, and an email or a phone number (spec B2). */
export function contactProblem(input: Pick<SupplierContact, "name" | "email" | "mobile" | "officePhone" | "whatsapp">) {
  if (!input.name.trim()) return "Enter the contact's name.";
  if (!input.email.trim() && !input.mobile.trim() && !input.officePhone.trim()) {
    return "Add an email or a phone number.";
  }
  if (input.whatsapp && !input.mobile.trim()) return "WhatsApp needs a mobile number.";
  return null;
}

/** A click-to-chat link for a mobile number (spec B1), with the US country code added. */
export function whatsappLink(mobile: string): string {
  const number = digits(mobile);
  return `https://wa.me/${number.length === 10 ? `1${number}` : number}`;
}

/** The best number to call: the mobile, then the office phone (ADR 0022). */
export function callNumber(contact: Pick<SupplierContact, "mobile" | "officePhone">): string {
  return contact.mobile || contact.officePhone;
}
