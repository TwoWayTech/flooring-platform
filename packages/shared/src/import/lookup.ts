import { dec } from "../money";
import { US_STATES } from "../us-pack/states";
import type { Address, Location } from "../types";
import { sameRecord } from "./canonical";
import { fold } from "./fields";
import type { Found, PartyIndex } from "./lookups";
import type { ImportField, ImportUser } from "./types";
import type { ParsedRow, PlanContext } from "./plan";

const same = (a: string | undefined, b: string) => !!a && fold(a) === fold(b);

/**
 * A customer, supplier or employee a cell names (spec rule 8, "match on external ID, SKU or
 * email"): by external ID first, then email, then the exact name. Several matches are refused by
 * the caller, never "the first one" (ADR 0057 S-16).
 */
export function findParty<T extends { id: string; name: string; email: string; externalId?: string }>(
  index: PartyIndex<T>,
  key: string,
): Found<T> {
  return index.find(key);
}

/** A user by email, then name, such as a sales rep. */
export function findUser(index: PartyIndex<ImportUser>, key: string): Found<ImportUser> {
  const byEmail = index.byEmail(key);
  return "none" in byEmail ? index.byName(key) : byEmail;
}

/** The words for a key that matches several records (ADR 0057 S-16): "2 customers match “Sam”. Use …". */
export function ambiguous(count: number, nouns: string, key: string, hint: string): string {
  return `${count} ${nouns} match “${key}”. ${hint}`;
}

/** Whether a stored decimal and a file's value are the same number: "3.4000" and "3.40" are. */
export function sameDecimal(stored: string | undefined, next: string): boolean {
  return stored !== undefined && stored !== "" && dec(stored).eq(next);
}

/**
 * The value an update writes for a decimal: the stored string when the file's value is the same
 * number, else the file's (spec rule 7; ADR 0057 S-11). Without it the database's "3.4000" for a
 * file's "3.40" would make every re-import an update. Null (an empty cell) changes nothing.
 */
export function keepStored(stored: string | undefined, next: string | null): string | null {
  if (next === null) return null;
  return sameDecimal(stored, next) ? stored! : next;
}

/** A warehouse or showroom by name. */
export function findLocation(locations: readonly Location[], name: string): Location | undefined {
  return locations.find((l) => same(l.name, name));
}

/** The user records are made by: the importer, or for the platform admin the company's first active user. */
export function ownerOf(ctx: PlanContext): ImportUser {
  const users = ctx.world.users;
  return users.find((u) => u.id === ctx.actorId) ?? users.find((u) => u.status === "active") ?? users[0]!;
}

/** The text of a parsed cell, or the fallback when it is empty. */
export const text = (row: ParsedRow, key: string, fallback = "") => (row[key] as string | null) ?? fallback;

/** The four address columns (spec G1), required or not, within the sales and purchasing routes' lengths (ADR 0057 S-12). */
export function addressFields(required: boolean): ImportField[] {
  return [
    {
      key: "street",
      label: "Street",
      type: "text",
      required,
      maxLength: 200,
      aliases: ["address", "address 1", "street address"],
      examples: ["4870 Quarry Lane", "220 Larkspur Avenue"],
    },
    {
      key: "city",
      label: "City",
      type: "text",
      required,
      maxLength: 100,
      aliases: ["town"],
      examples: ["Denver", "Boulder"],
    },
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
      maxLength: 10,
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

/**
 * The record with only the given changes, or null when nothing would change (spec rule 7). The
 * versions compare by content, not key order (ADR 0057 S-11).
 */
export function patched<T extends object>(record: T, changes: { [K in keyof T]?: T[K] | null }): T | null {
  const given = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null && v !== undefined));
  const next = { ...record, ...given };
  return sameRecord(next, record) ? null : next;
}
