import type { CompanyDb, ControlDb } from "@workspace/db";
import { branches, customers, locations, products, roles, suppliers } from "@workspace/db/company";
import { member, user } from "@workspace/db/control";
import { and, eq, inArray } from "drizzle-orm";
import { validate as isUuid } from "uuid";

/** A field that holds a record's id: `locationId`, `roleIds`, `sales_rep_id`. Only these are named. */
const ID_FIELD = /(Id|Ids|_id|_ids)$/;

/**
 * The UUIDs a before or after value holds under id fields (`…Id`, `…Ids`), at any depth. A UUID in
 * any other field, such as a customer's name typed as one, is text and is never looked up, so the
 * log can't be used to probe for records (PR #97 security review).
 */
export function uuidsIn(value: unknown, into: Set<string> = new Set(), idField = false): Set<string> {
  if (typeof value === "string") {
    if (idField && isUuid(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) uuidsIn(item, into, idField);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) uuidsIn(inner, into, ID_FIELD.test(key));
  }
  return into;
}

/**
 * The names of the records these ids stand for, so the audit log reads "Denver Central" rather
 * than a UUID (click-through #58): warehouses and showrooms, branches, customers, suppliers,
 * products and roles from the company's own database, and people only among the company's members
 * in the control database (CLAUDE.md rule 2), so no other company's user is ever named. Names only,
 * never a sensitive field; an id that matches nothing is left out and shown as an id.
 */
export async function auditNames(
  company: CompanyDb,
  control: ControlDb,
  companyId: string,
  ids: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  const list = [...ids];
  const found = await Promise.all([
    company.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, list)),
    company.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, list)),
    company.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, list)),
    company.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, list)),
    company.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, list)),
    company.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, list)),
    control
      .select({ id: user.id, name: user.name })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, companyId), inArray(user.id, list))),
  ]);
  for (const rows of found) for (const row of rows) names.set(row.id, row.name);
  return names;
}
