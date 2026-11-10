import { billLedgerIndex, contactProblem, dec, type Supplier, type SupplierContact } from "@workspace/shared";
import type { SupplierContactInput, SupplierInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import type { ActionContext } from "./payment-actions";

const NO_ADDRESS = { street: "", city: "", state: "", zip: "" };

/**
 * Adds or edits a supplier (spec B1). Only a name is required, so one can be added in the middle
 * of a purchase order and finished later; a supplier added that way has terms of pay on order and
 * no credit (ADR 0022).
 */
export async function saveSupplier(ctx: ActionContext, input: SupplierInput): Promise<Supplier> {
  await ctx.assertCan([input.id ? "purchasing.supplier.edit" : "purchasing.supplier.create"]);
  const name = input.name.trim();
  if (!name) throw new DemoRuleError("Enter the supplier's name.");
  const before = input.id ? ctx.db.get("suppliers", input.id) : undefined;
  if (input.id && !before) throw new DemoRuleError("This supplier no longer exists.");
  const supplier: Supplier = {
    id: before?.id ?? ctx.newId("sup"),
    name,
    type: input.type ?? before?.type ?? "goods",
    status: before?.status ?? "active",
    accountNumber: input.accountNumber ?? before?.accountNumber ?? "",
    email: input.email ?? before?.email ?? "",
    phone: input.phone ?? before?.phone ?? "",
    terms: input.terms ?? before?.terms ?? "pay_on_order",
    creditLimit: input.creditLimit ?? before?.creditLimit ?? "0.00",
    categories: before?.categories ?? [],
    address: input.address ?? before?.address ?? NO_ADDRESS,
    track1099: input.track1099 ?? before?.track1099 ?? false,
    taxForm: input.taxForm ?? before?.taxForm ?? null,
    notes: input.notes ?? before?.notes ?? "",
    ...(before?.externalId ? { externalId: before.externalId } : {}),
  };
  ctx.db.put("suppliers", supplier);
  ctx.audit({
    category: "data",
    action: before
      ? "Edited supplier"
      : input.from === "order"
        ? "Added supplier from a purchase order"
        : "Added supplier",
    target: name,
    before: before?.name ?? null,
    after: name,
  });
  return supplier;
}

/**
 * Deactivates or reactivates a supplier (ADR 0022): never deleted, and one with an open order or a
 * balance stays active. Inactive suppliers leave the pickers and stay in history.
 */
export async function setSupplierStatus(ctx: ActionContext, id: string, status: Supplier["status"]) {
  await ctx.assertCan(["purchasing.supplier.edit"]);
  const supplier = ctx.db.get("suppliers", id);
  if (!supplier) throw new DemoRuleError("This supplier no longer exists.");
  if (status === "inactive") {
    const open = ctx.db.list("purchaseOrders").some((p) => p.supplierId === id && p.status === "ordered");
    const ledgers = billLedgerIndex(
      ctx.db.list("bills").filter((b) => b.supplierId === id),
      ctx.db.list("supplierPayments"),
      ctx.today,
    );
    const owes = [...ledgers.values()].some((l) => dec(l.balance).gt(0));
    if (open || owes) throw new DemoRuleError(`${supplier.name} has an open order or a balance, so it stays active.`);
  }
  const saved = ctx.db.put("suppliers", { ...supplier, status });
  ctx.audit({
    category: "data",
    action: "Changed supplier status",
    target: supplier.name,
    before: supplier.status,
    after: status,
  });
  return saved;
}

/** Makes one contact the supplier's only primary (ADR 0022). */
function clearOtherPrimaries(ctx: ActionContext, keep: SupplierContact) {
  for (const c of ctx.db.list("supplierContacts")) {
    if (c.supplierId === keep.supplierId && c.id !== keep.id && c.isPrimary) {
      ctx.db.put("supplierContacts", { ...c, isPrimary: false });
    }
  }
}

/**
 * Adds or edits a contact (spec B1, B2): a name plus an email or a phone. The first contact of a
 * supplier becomes primary, and marking another clears the old one.
 */
export async function saveSupplierContact(ctx: ActionContext, input: SupplierContactInput): Promise<SupplierContact> {
  await ctx.assertCan([input.id ? "purchasing.supplier.edit" : "purchasing.supplier.create"]);
  const supplier = ctx.db.get("suppliers", input.supplierId);
  if (!supplier) throw new DemoRuleError("This supplier no longer exists.");
  const problem = contactProblem(input);
  if (problem) throw new DemoRuleError(problem);
  const before = input.id ? ctx.db.get("supplierContacts", input.id) : undefined;
  const others = ctx.db.list("supplierContacts").filter((c) => c.supplierId === supplier.id && c.status === "active");
  const contact: SupplierContact = {
    id: before?.id ?? ctx.newId("con"),
    supplierId: supplier.id,
    name: input.name.trim(),
    role: input.role,
    mobile: input.mobile.trim(),
    officePhone: input.officePhone.trim(),
    email: input.email.trim(),
    whatsapp: input.whatsapp,
    preferredMethod: input.preferredMethod,
    notes: input.notes.trim(),
    isPrimary: input.isPrimary || others.filter((c) => c.id !== before?.id).length === 0,
    status: before?.status ?? "active",
  };
  ctx.db.put("supplierContacts", contact);
  if (contact.isPrimary) clearOtherPrimaries(ctx, contact);
  ctx.audit({
    category: "data",
    action: before ? "Edited supplier contact" : "Added supplier contact",
    target: `${contact.name}, ${supplier.name}`,
    before: before?.name ?? null,
    after: contact.name,
  });
  return contact;
}

/**
 * Deactivates or reactivates a contact (ADR 0022). When the primary leaves, the oldest active
 * sales rep takes over, then the oldest active contact.
 */
export async function setContactStatus(ctx: ActionContext, id: string, status: SupplierContact["status"]) {
  await ctx.assertCan(["purchasing.supplier.edit"]);
  const contact = ctx.db.get("supplierContacts", id);
  if (!contact) throw new DemoRuleError("This contact no longer exists.");
  const saved = ctx.db.put("supplierContacts", {
    ...contact,
    status,
    isPrimary: status === "active" && contact.isPrimary,
  });
  if (status === "inactive" && contact.isPrimary) {
    const rest = ctx.db
      .list("supplierContacts")
      .filter((c) => c.supplierId === contact.supplierId && c.status === "active");
    const next = rest.find((c) => c.role === "sales_rep") ?? rest[0];
    if (next) ctx.db.put("supplierContacts", { ...next, isPrimary: true });
  }
  ctx.audit({
    category: "data",
    action: "Changed supplier contact status",
    target: contact.name,
    before: contact.status,
    after: status,
  });
  return saved;
}
