import { addDays } from "../../src/dates";
import type { Customer, CustomerType, User } from "../../src/types";
import type { GenContext } from "./context";

/** Tax-exempt customers with resale certificates, and how many expire within 30 days (spec section 4). */
const EXEMPT_COUNT = 6;
const EXPIRING_SOON = 2;

const DEALER_SUFFIXES = ["Floor Gallery", "Carpet and Tile", "Interiors", "Flooring Center", "Design Studio"];
const CONTRACTOR_SUFFIXES = ["Builders", "Renovation", "Construction", "Remodeling", "Property Services"];

/** Active users with the Sales role; the first one is the Sales persona. */
export function salesReps(users: readonly User[]): User[] {
  return users.filter((u) => u.status === "active" && u.roleIds.some((r) => r.endsWith("-role-sales")));
}

function customerName(ctx: GenContext, type: CustomerType): { name: string; contactName: string } {
  const contactName = ctx.rng.personName();
  const lastName = contactName.split(" ").at(-1)!;
  if (type === "homeowner") return { name: contactName, contactName };
  const suffix = type === "dealer" ? ctx.rng.pick(DEALER_SUFFIXES) : ctx.rng.pick(CONTRACTOR_SUFFIXES);
  return { name: `${lastName} ${suffix}${ctx.rng.chance(0.4) ? " LLC" : ""}`, contactName };
}

/** Credit limits only exist on trade accounts; homeowners pay on receipt. */
function accountTerms(ctx: GenContext, type: CustomerType): Pick<Customer, "terms" | "creditLimit"> {
  if (type === "homeowner") return { terms: "due_on_receipt", creditLimit: "0.00" };
  if (type === "dealer")
    return { terms: ctx.rng.pick(["net_30", "net_30", "net_45"]), creditLimit: `${ctx.rng.int(10, 50)}000.00` };
  return { terms: ctx.rng.pick(["net_15", "net_30"]), creditLimit: `${ctx.rng.int(5, 25)}000.00` };
}

/**
 * Customers in the company's mix. Sales reps own accounts in turn, with the Sales persona
 * owning about 40 % so the "own records" data scope has plenty to show.
 */
export function buildCustomers(ctx: GenContext, users: readonly User[]): Customer[] {
  const reps = salesReps(users);
  const types = (Object.entries(ctx.company.customerMix) as [CustomerType, number][]).flatMap(([type, n]) =>
    Array<CustomerType>(n).fill(type),
  );
  let exemptLeft = EXEMPT_COUNT;
  return types.map((type) => {
    const exempt = type === "dealer" && exemptLeft > 0;
    const expiringSoon = exempt && exemptLeft <= EXPIRING_SOON;
    if (exempt) exemptLeft--;
    const address = ctx.address();
    return {
      id: ctx.id("cus"),
      type,
      ...customerName(ctx, type),
      email: `${ctx.rng.faker.internet.username().toLowerCase()}@mail.example`,
      phone: ctx.rng.phone(ctx.company.areaCode),
      address,
      ...accountTerms(ctx, type),
      taxExempt: exempt,
      certificate: exempt
        ? {
            number: `${address.state}-RC-${ctx.rng.int(100000, 999999)}`,
            state: address.state,
            expiresAt: addDays(ctx.anchor, expiringSoon ? ctx.rng.int(6, 28) : ctx.rng.int(120, 700)),
          }
        : null,
      salesRepId: ctx.rng.chance(0.4) ? reps[0]!.id : ctx.rng.pick(reps).id,
      createdAt: addDays(ctx.anchor, -ctx.rng.int(30, 1400)),
    };
  });
}
