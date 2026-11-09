import { US_STATES } from "../us-pack/states";
import type { Address, Location, User } from "../types";
import { fold } from "./fields";
import type { ImportField } from "./types";
import type { ParsedRow, PlanContext } from "./plan";

const same = (a: string | undefined, b: string) => !!a && fold(a) === fold(b);

/**
 * A customer, supplier or employee a cell names (spec G1 "match on external ID, SKU or email"):
 * by external ID first, then email, then the exact name.
 */
export function findParty<T extends { name: string; email: string; externalId?: string }>(
  list: readonly T[],
  key: string,
): T | undefined {
  return (
    list.find((p) => same(p.externalId, key)) ??
    list.find((p) => same(p.email, key)) ??
    list.find((p) => same(p.name, key))
  );
}

/** A user by name or email, such as a sales rep. */
export function findUser(users: readonly User[], key: string): User | undefined {
  return users.find((u) => same(u.email, key) || same(u.name, key));
}

/** A warehouse or showroom by name. */
export function findLocation(locations: readonly Location[], name: string): Location | undefined {
  return locations.find((l) => same(l.name, name));
}

/** The user records are made by: the importer, or for the platform admin the company's first active user. */
export function ownerOf(ctx: PlanContext): User {
  const users = ctx.world.users;
  return users.find((u) => u.id === ctx.actorId) ?? users.find((u) => u.status === "active") ?? users[0]!;
}

/** The text of a parsed cell, or the fallback when it is empty. */
export const text = (row: ParsedRow, key: string, fallback = "") => (row[key] as string | null) ?? fallback;

/** The four address columns (spec G1), required or not. */
export function addressFields(required: boolean): ImportField[] {
  return [
    {
      key: "street",
      label: "Street",
      type: "text",
      required,
      aliases: ["address", "address 1", "street address"],
      examples: ["4870 Quarry Lane", "220 Larkspur Avenue"],
    },
    { key: "city", label: "City", type: "text", required, aliases: ["town"], examples: ["Denver", "Boulder"] },
    {
      key: "state",
      label: "State",
      type: "choice",
      required,
      choices: Object.fromEntries(US_STATES),
      aliases: ["st", "province"],
      examples: ["CO", "CO"],
    },
    {
      key: "zip",
      label: "ZIP",
      type: "text",
      required,
      aliases: ["zip code", "postal code", "postcode"],
      examples: ["80216", "80302"],
    },
  ];
}

const ZIP = /^\d{5}(-\d{4})?$/;

/**
 * The address a row gives, if any: all four columns together or none, with a US ZIP code. An
 * error names what is missing.
 */
export function rowAddress(row: ParsedRow): { address: Address | null } | { error: string; field: string } {
  const parts = {
    street: text(row, "street"),
    city: text(row, "city"),
    state: text(row, "state"),
    zip: text(row, "zip"),
  };
  const given = Object.values(parts).filter(Boolean).length;
  if (given === 0) return { address: null };
  const missing = (Object.keys(parts) as (keyof typeof parts)[]).find((k) => !parts[k]);
  if (missing) return { error: "Give street, city, state and ZIP together, or leave all four empty.", field: missing };
  if (!ZIP.test(parts.zip)) return { error: `“${parts.zip}” is not a US ZIP code.`, field: "zip" };
  return { address: parts };
}

/** The record with only the given changes, or null when nothing would change. */
export function patched<T extends object>(record: T, changes: { [K in keyof T]?: T[K] | null }): T | null {
  const given = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null && v !== undefined));
  const next = { ...record, ...given };
  return JSON.stringify(next) === JSON.stringify(record) ? null : next;
}
