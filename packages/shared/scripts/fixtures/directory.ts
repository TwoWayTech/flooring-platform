import type { CompanyFixtures, ContactRole, Supplier, SupplierContact, SupplierType } from "../../src/types";
import type { GenContext } from "./context";
import { Rng } from "./random";

/** Service, utility and government vendors for expenses (spec B1, F1). Names are invented. */
const VENDORS: readonly { name: string; type: SupplierType; domain: string }[] = [
  { name: "Redrock Property Management", type: "services", domain: "redrockpm" },
  { name: "Frontier Power and Light", type: "utility", domain: "frontierpower" },
  { name: "Metro Water District", type: "utility", domain: "metrowater" },
  { name: "Peakline Internet and Phone", type: "services", domain: "peakline" },
  { name: "Ledger and Pine CPAs", type: "services", domain: "ledgerpine" },
  { name: "Harbor Mutual Insurance", type: "services", domain: "harbormutual" },
  { name: "BrightSign Marketing", type: "services", domain: "brightsign" },
  { name: "FastLane Fleet Fuel", type: "services", domain: "fastlanefleet" },
  { name: "State Revenue Office", type: "government", domain: "staterevenue" },
];

const EXTRA_ROLES: readonly ContactRole[] = ["account_manager", "accounts_receivable", "sales_rep"];

/** A supplier as the catalog builder makes it, with the contact name it drew for the directory. */
export type GeneratedSupplier = Omit<
  Supplier,
  "type" | "status" | "accountNumber" | "track1099" | "taxForm" | "notes"
> & {
  contactName: string;
};

/**
 * The supplier directory (spec B1, batch 3 G): every goods supplier gets its drawn contact as a
 * primary sales rep and up to two more people, service vendors are added, and orders point at
 * their rep. It runs last, on its own random stream, so the records built before it do not move.
 */
export function withDirectory(ctx: GenContext, fixtures: CompanyFixtures): CompanyFixtures {
  if (fixtures.suppliers.length === 0) return { ...fixtures, supplierContacts: [] };
  const rng = new Rng(ctx.company.seed + 7);
  const contacts: SupplierContact[] = [];
  const contact = (supplierId: string, name: string, role: ContactRole, isPrimary: boolean, domain: string) => {
    const first = name.split(" ")[0]!.toLowerCase();
    const mobile = rng.phone(String(rng.int(201, 989)));
    contacts.push({
      id: ctx.id("con"),
      supplierId,
      name,
      role,
      mobile,
      officePhone: rng.phone(String(rng.int(201, 989))),
      email: `${first}@${domain}.example`,
      whatsapp: rng.chance(0.4),
      preferredMethod: rng.pick(["call", "email"] as const),
      notes: isPrimary && rng.chance(0.3) ? rng.pick(["Best before 10 am.", "Ask for the contractor desk."]) : "",
      isPrimary,
      status: "active",
    });
  };
  const goods = (fixtures.suppliers as unknown as GeneratedSupplier[]).map((generated) => {
    const { contactName, ...rest } = generated;
    const domain = rest.email.split("@")[1]!.replace(".example", "");
    const supplier: Supplier = {
      ...rest,
      type: "goods",
      status: "active",
      accountNumber: `AC-${rng.int(10000, 99999)}`,
      track1099: false,
      taxForm: null,
      notes: "",
    };
    contact(supplier.id, contactName, "sales_rep", true, domain);
    for (const role of rng.sample(EXTRA_ROLES, rng.int(0, 2)))
      contact(supplier.id, rng.personName(), role, false, domain);
    return supplier;
  });
  const vendors = VENDORS.map(({ name, type, domain }): Supplier => {
    const id = ctx.id("sup");
    if (type !== "government") contact(id, rng.personName(), "account_manager", true, domain);
    return {
      id,
      name,
      type,
      status: "active",
      accountNumber: `AC-${rng.int(10000, 99999)}`,
      email: `billing@${domain}.example`,
      phone: rng.phone(ctx.company.areaCode),
      terms: "net_30",
      creditLimit: "0.00",
      categories: [],
      address: ctx.address(),
      track1099: type === "services",
      taxForm:
        type === "services"
          ? { w9OnFile: true, receivedAt: "2026-01-15", legalName: name, entityType: "LLC", exemptFromReporting: false }
          : null,
      notes: "",
    };
  });
  const buyer = fixtures.users.find((u) => u.roleIds.some((r) => r.endsWith("-role-manager"))) ?? fixtures.users[0]!;
  const purchaseOrders = fixtures.purchaseOrders.map((po) => {
    const rep = contacts.find((c) => c.supplierId === po.supplierId && c.isPrimary);
    return {
      ...po,
      contactId: rep?.id ?? null,
      contactSnapshot: po.status === "ordered" && rep ? { name: rep.name, email: rep.email, phone: rep.mobile } : null,
      supplierRef: "",
      buyerId: buyer.id,
      placedVia: po.status === "ordered" ? ("email" as const) : null,
    };
  });
  return { ...fixtures, suppliers: [...goods, ...vendors], supplierContacts: contacts, purchaseOrders };
}
