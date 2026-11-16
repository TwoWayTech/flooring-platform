import type { CompanyDb, ControlDb } from "@workspace/db";
import type { ImportChange, ImportCollection, ImportWorld } from "@workspace/shared";

/** The tables an import creates rows in, which the Undo reference check looks for links to. */
export type ReferenceTable = "customers" | "addresses" | "suppliers" | "supplier_contacts" | "products";

/** One row an import created: a record, or a part of one such as a customer's address. */
export interface ReferenceTarget {
  table: ReferenceTable;
  id: string;
}

/** How a collection's records are named in the audit log and found by the reference check. */
export interface RecordKind {
  /** "customer", "supplier contact", … as the audit actions word it. */
  noun: string;
  /** The module's own audit target type, so the record's history reads as one. */
  targetType: string;
  table: ReferenceTable;
}

/**
 * How one kind reads and writes the company's records (ADR 0057 api 4.7). Reads go through the
 * modules' own loaders, so a record is planned, compared and audited exactly as its module shows
 * it; writes go through the row functions, which are the only place a store turns a shared record
 * into a database row.
 */
export interface KindStore {
  /** Locks the kind's tables in the module's own order, so module writes wait and nothing slips past the plan. */
  lock(tx: CompanyDb): Promise<void>;
  /** The records the kind's plan reads. */
  world(tx: CompanyDb, control: ControlDb): Promise<Partial<ImportWorld>>;
  /** Writes one planned change; `actorId` is recorded as the creator of new rows. */
  write(tx: CompanyDb, change: ImportChange, actorId: string): Promise<void>;
  /** The live records of the changes, by `changeKey`, as their loaders read them now. */
  current(tx: CompanyDb, changes: readonly ImportChange[]): Promise<Map<string, unknown>>;
  /** Rows a change created besides the record itself, such as new addresses of a customer. */
  createdParts(change: ImportChange): ReferenceTarget[];
  /** Why the kind's own rules stop an Undo of these changes, or null (products: ADR 0057 M4, M6). */
  undoProblem(tx: CompanyDb, changes: readonly ImportChange[]): Promise<string | null>;
  /** Puts one change back: a created record is soft-deleted with its parts, an updated one gets its earlier columns. */
  undo(tx: CompanyDb, change: ImportChange): Promise<void>;
  /** How a collection's records are named and audited. */
  record(collection: ImportCollection): RecordKind;
  /** What the audit log keeps of a record, before or after. */
  shape(collection: ImportCollection, record: unknown): unknown;
}

/** The key `current` answers a change under. */
export const changeKey = (change: Pick<ImportChange, "collection" | "id">) => `${change.collection}:${change.id}`;

/** The ids of the changes to one collection. */
export const idsOf = (changes: readonly ImportChange[], collection: ImportCollection) =>
  changes.filter((change) => change.collection === collection).map((change) => change.id);

/** Records keyed as `current` answers them. */
export function byChangeKey(collection: ImportCollection, records: readonly { id: string }[]): Map<string, unknown> {
  return new Map(records.map((record) => [changeKey({ collection, id: record.id }), record]));
}
