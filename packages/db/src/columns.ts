import { date, numeric, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/**
 * Column helpers that carry the blueprint's table rules (blueprint p15, p23), so every table gets
 * them the same way. Column names come from the property names in snake_case (`casing` in the
 * drizzle configs and clients). The table-rules test checks every table against these rules.
 */

/** Primary key: UUID v7, made in the app because PostgreSQL 16 has no uuidv7() (ADR 0028). */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** A timestamp with time zone; every moment is stored in UTC. */
export const at = () => timestamp({ withTimezone: true });

/** A calendar day without a time (due dates, pay days, effective dates), read as YYYY-MM-DD. */
export const day = () => date({ mode: "string" });

/** A user id held in the control database. Users live in another database, so this cannot be a foreign key. */
export const userRef = () => uuid();

/** created_at, updated_at and created_by, which every table carries (blueprint p15). */
const audit = () => ({
  createdAt: at().notNull().defaultNow(),
  updatedAt: at()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: userRef(),
});

/**
 * The columns of a business record: id, audit columns and soft delete (deleted_at), because
 * business records are marked deleted, never removed (blueprint p15). Spread first in pgTable.
 */
export const business = () => ({ id: id(), ...audit(), deletedAt: at() });

/**
 * The columns of an append-only row: id and audit columns, no soft delete. For ledgers and logs
 * that are corrected by a new row, never by changing or hiding one (audit log, stock movements).
 */
export const appendOnly = () => ({ id: id(), ...audit() });

/** Money: numeric(14,2), read as a decimal string for decimal.js. Never a float. */
export const money = () => numeric({ precision: 14, scale: 2 });

/** Unit prices and costs, per sq ft or per item: numeric(14,4). */
export const unitCost = () => numeric({ precision: 14, scale: 4 });

/** Quantities in the base unit (sq ft, ft, items, hours): numeric(14,3) (ADR 0027, square feet). */
export const quantity = () => numeric({ precision: 14, scale: 3 });

/** Percentages and exchange rates: numeric(18,8). */
export const rate = () => numeric({ precision: 18, scale: 8 });
