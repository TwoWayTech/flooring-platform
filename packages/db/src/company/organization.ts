import type { Address, CompanySettings, LocationKind, StateCode, TaxCategory } from "@workspace/shared";
import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { business, day, quantity, rate } from "../columns";

/** A store or office; drives data scope and the branch limit (data-model.md, Organization). */
export const branches = pgTable("branches", {
  ...business(),
  name: text().notNull(),
  city: text().notNull(),
  state: text().notNull(),
});

/**
 * A warehouse or showroom in a branch (ADR 0006). Bins are a text field on rolls, not
 * locations of their own (data-model.md, Changes this demo introduced).
 */
export const locations = pgTable("locations", {
  ...business(),
  name: text().notNull(),
  kind: text().$type<LocationKind>().notNull(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  address: jsonb().$type<Address>().notNull(),
  isDefault: boolean().notNull().default(false),
  displaySamples: integer().notNull().default(0),
  floorAreaSqFt: quantity(),
});

/** A settings group of CompanySettings, except branding, which lives in the control database. */
export type SettingsGroup = Exclude<keyof CompanySettings, "branding">;

/**
 * One row per settings group, holding that group as JSON (packages/shared/src/types/settings.ts).
 * Tax rules and county rates are their own tables because they carry effective dates.
 */
export const settings = pgTable(
  "settings",
  {
    ...business(),
    group: text().$type<SettingsGroup>().notNull(),
    value: jsonb().notNull(),
  },
  (table) => [uniqueIndex("settings_group_uidx").on(table.group)],
);

/**
 * The next number per document kind (quote, invoice, payment). Replaces the demo's highest number
 * plus one, which is unsafe with concurrent writes (data-model.md, Points for the real build).
 */
export const documentSequences = pgTable(
  "document_sequences",
  {
    ...business(),
    kind: text().notNull(),
    prefix: text().notNull(),
    nextValue: integer().notNull().default(1),
  },
  (table) => [uniqueIndex("document_sequences_kind_uidx").on(table.kind)],
);

/**
 * A state sales-tax rule with its version and effective dates. A posted document stores the
 * version it used, so changing a rule never alters history (blueprint p21, spec A5).
 */
export const taxRules = pgTable(
  "tax_rules",
  {
    ...business(),
    state: text().$type<StateCode>().notNull(),
    jurisdiction: text().notNull(),
    ratePct: rate().notNull(),
    taxable: jsonb().$type<Record<TaxCategory, boolean>>().notNull(),
    lumpSumLaborTaxable: boolean().notNull().default(false),
    validFrom: day().notNull(),
    validTo: day(),
    version: integer().notNull(),
    rationale: text().notNull().default(""),
  },
  (table) => [uniqueIndex("tax_rules_version_uidx").on(table.state, table.version)],
);

/** A county rate that replaces the state default (spec A5): county → state → company default. */
export const taxJurisdictions = pgTable("tax_jurisdictions", {
  ...business(),
  state: text().$type<StateCode>().notNull(),
  county: text().notNull(),
  name: text().notNull(),
  ratePct: rate().notNull(),
  validFrom: day().notNull(),
  validTo: day(),
});
