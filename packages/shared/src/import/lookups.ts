import type { Customer, Employee, Product, Roll, StockMovement, Supplier } from "../types";
import { fold } from "./fields";
import type { ImportWorld } from "./plan";
import type { ImportCollection, ImportUser } from "./types";

/** What a key finds: exactly one record, none, or several (several is refused, ADR 0057 S-16). */
export type Found<T> = { one: T } | { none: true } | { many: number };

/** The records a key found, as one, none or several. */
export function foundOf<T>(records: readonly T[]): Found<T> {
  if (records.length === 0) return { none: true };
  if (records.length === 1) return { one: records[0]! };
  return { many: records.length };
}

/** An email as matched: trimmed and lower case, with nothing else folded (ADR 0057 S-16). */
export const emailKey = (email: string) => email.trim().toLowerCase();

/** A SKU as matched: lower case, as the products kind always has (spec G1 "match on SKU"). */
export const skuKey = (sku: string) => sku.toLowerCase();

/**
 * Records by a normalized key, built once per plan and kept current as rows write (ADR 0057 M7),
 * so planning stays linear in rows plus records. Empty keys are never indexed or found.
 */
export class KeyIndex<T extends { id: string }> {
  private readonly byKey = new Map<string, Map<string, T>>();
  private readonly keysById = new Map<string, readonly string[]>();
  private readonly keysOf: (record: T) => readonly (string | undefined)[];
  private readonly normalize: (key: string) => string;

  /** Indexes the records under each key `keysOf` gives, normalized by `normalize` (`fold` unless given). */
  constructor(
    records: readonly T[],
    keysOf: (record: T) => readonly (string | undefined)[],
    normalize: (key: string) => string = fold,
  ) {
    this.keysOf = keysOf;
    this.normalize = normalize;
    for (const record of records) this.put(record);
  }

  /** The records whose normalized key equals the normalized `key`. */
  find(key: string): readonly T[] {
    const wanted = this.normalize(key);
    return wanted ? [...(this.byKey.get(wanted)?.values() ?? [])] : [];
  }

  /** Adds a record, or replaces the keys the same id had. */
  put(record: T): void {
    for (const old of this.keysById.get(record.id) ?? []) this.byKey.get(old)?.delete(record.id);
    const keys = [
      ...new Set(
        this.keysOf(record)
          .filter((k): k is string => !!k)
          .map(this.normalize)
          .filter(Boolean),
      ),
    ];
    for (const key of keys) {
      const bucket = this.byKey.get(key) ?? new Map<string, T>();
      bucket.set(record.id, record);
      this.byKey.set(key, bucket);
    }
    this.keysById.set(record.id, keys);
  }
}

/** The fields a party is found by. */
type PartyLike = { id: string; name: string; email: string; externalId?: string };

/**
 * A party (customer, supplier, employee or user) by external ID, then email, then exact name
 * (spec rule 8). External IDs and names compare with `fold`; emails compare exactly, ignoring
 * case only, so "j-smith@" never finds "j_smith@" (ADR 0057 S-16).
 */
export class PartyIndex<T extends PartyLike> {
  private readonly ext: KeyIndex<T>;
  private readonly email: KeyIndex<T>;
  private readonly name: KeyIndex<T>;

  /** Indexes the parties by their three keys. */
  constructor(records: readonly T[]) {
    this.ext = new KeyIndex(records, (r) => [r.externalId]);
    this.email = new KeyIndex(records, (r) => [r.email], emailKey);
    this.name = new KeyIndex(records, (r) => [r.name]);
  }

  /** The parties with this external ID. */
  byExternalId(key: string): Found<T> {
    return foundOf(this.ext.find(key));
  }

  /** The parties with this email. */
  byEmail(key: string): Found<T> {
    return foundOf(this.email.find(key));
  }

  /** The parties with this exact name (folded). */
  byName(key: string): Found<T> {
    return foundOf(this.name.find(key));
  }

  /** The first of external ID, email, name that finds anything decides: one record, or several (refused). */
  find(key: string): Found<T> {
    for (const found of [this.byExternalId(key), this.byEmail(key), this.byName(key)]) {
      if (!("none" in found)) return found;
    }
    return { none: true };
  }

  /** Adds a party, or re-indexes it under its new keys. */
  put(record: T): void {
    this.ext.put(record);
    this.email.put(record);
    this.name.put(record);
  }
}

/** Product ids with stock history in the world's own movements and rolls (the demo's lists). */
function stockedIn(world: ImportWorld): Set<string> {
  return new Set([...world.stockMovements.map((m) => m.productId), ...world.rolls.map((r) => r.productId)]);
}

/**
 * The plan's lookups over its working copy (ADR 0057 M7), each built on first use, so a
 * timesheets plan builds none of them. `put` writes a record into the working copy and keeps
 * every built index current, so later rows of the file see it.
 */
export class ImportLookups {
  private readonly world: ImportWorld;
  private readonly positions = new Map<ImportCollection, Map<string, number>>();
  private customerIndex?: PartyIndex<Customer>;
  private supplierIndex?: PartyIndex<Supplier>;
  private employeeIndex?: PartyIndex<Employee>;
  private userIndex?: PartyIndex<ImportUser>;
  private skuIndex?: KeyIndex<Product>;
  private retired?: ReadonlySet<string>;
  private stocked?: Set<string>;

  /** Lookups over `world`, which must be the plan's own working copy: `put` changes it. */
  constructor(world: ImportWorld) {
    this.world = world;
  }

  /** Customers by external ID, email and name. */
  get customers(): PartyIndex<Customer> {
    this.customerIndex ??= new PartyIndex(this.world.customers);
    return this.customerIndex;
  }

  /** Suppliers by external ID, email and name. */
  get suppliers(): PartyIndex<Supplier> {
    this.supplierIndex ??= new PartyIndex(this.world.suppliers);
    return this.supplierIndex;
  }

  /** Employees by external ID, email and name. */
  get employees(): PartyIndex<Employee> {
    this.employeeIndex ??= new PartyIndex(this.world.employees);
    return this.employeeIndex;
  }

  /** Company members by email and name (they have no external ID). */
  get users(): PartyIndex<ImportUser> {
    this.userIndex ??= new PartyIndex(this.world.users);
    return this.userIndex;
  }

  /** Live products by lower-case SKU. */
  get productsBySku(): KeyIndex<Product> {
    this.skuIndex ??= new KeyIndex(this.world.products, (p) => [p.sku], skuKey);
    return this.skuIndex;
  }

  /** Lower-case SKUs held by deleted products (ADR 0057 S-6); the demo never retires one. */
  get retiredSkus(): ReadonlySet<string> {
    this.retired ??= new Set((this.world.retiredSkus ?? []).map(skuKey));
    return this.retired;
  }

  /**
   * Product ids with any stock history (ADR 0057 S-5): the API's set when given, else the ids in
   * the world's movements and rolls.
   */
  get productsWithStock(): ReadonlySet<string> {
    this.stocked ??= this.world.productsWithStock ? new Set(this.world.productsWithStock) : stockedIn(this.world);
    return this.stocked;
  }

  /** Each record's position in the working copy's collection, by id. */
  byId(collection: ImportCollection): Map<string, number> {
    let ids = this.positions.get(collection);
    if (!ids) {
      ids = new Map((this.world[collection] as readonly { id: string }[]).map((r, i) => [r.id, i]));
      this.positions.set(collection, ids);
    }
    return ids;
  }

  /** Writes a record into the working copy, replacing the one with its id, and keeps every built index current. */
  put(collection: ImportCollection, record: { id: string }): void {
    const list = this.world[collection] as { id: string }[];
    const ids = this.byId(collection);
    const at = ids.get(record.id);
    if (at === undefined) {
      ids.set(record.id, list.length);
      list.push(record);
    } else list[at] = record;
    this.reindex(collection, record);
  }

  /** Re-indexes a written record in the indexes built so far. */
  private reindex(collection: ImportCollection, record: { id: string }): void {
    if (collection === "customers") this.customerIndex?.put(record as Customer);
    if (collection === "suppliers") this.supplierIndex?.put(record as Supplier);
    if (collection === "employees") this.employeeIndex?.put(record as Employee);
    if (collection === "products") this.skuIndex?.put(record as Product);
    if (collection === "stockMovements" || collection === "rolls") {
      this.stocked?.add((record as StockMovement | Roll).productId);
    }
  }
}
