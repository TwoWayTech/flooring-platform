import type { CompanyDb, ControlDb } from "@workspace/db";
import { branches, customers, locations, products, roles, suppliers } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import { inArray } from "drizzle-orm";
import { validate as isUuid } from "uuid";

/** Every UUID a before or after value holds, at any depth, as a string value. */
export function uuidsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (isUuid(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) uuidsIn(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) uuidsIn(inner, into);
  }
  return into;
}

/**
 * The names of the records these ids stand for, so the audit log reads "Denver Central" rather
 * than a UUID (click-through #58): warehouses and showrooms, branches, customers, suppliers,
 * products and roles from the company database, and people from the control database. Names
 * only, never a sensitive field; an id that matches nothing is left out and shown as an id.
 */
export async function auditNames(
  company: CompanyDb,
  control: ControlDb,
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
    control.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, list)),
  ]);
  for (const rows of found) for (const row of rows) names.set(row.id, row.name);
  return names;
}
