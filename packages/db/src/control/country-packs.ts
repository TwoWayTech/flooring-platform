import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { business } from "../columns";

/**
 * Country rules shared by every company (blueprint "Localization, currency and tax"). Today the
 * rules are code in packages/shared/src/us-pack; these tables hold them once a pack is edited
 * without a deploy. The US pack is the only one.
 */
export const countryPacks = pgTable(
  "country_packs",
  {
    ...business(),
    code: text().notNull(),
    name: text().notNull(),
    currency: text().notNull(),
  },
  (table) => [uniqueIndex("country_packs_code_uidx").on(table.code)],
);

/** A state in a pack, with whether its sales tax is set up. */
export const packStates = pgTable(
  "pack_states",
  {
    ...business(),
    packId: uuid()
      .notNull()
      .references(() => countryPacks.id),
    code: text().notNull(),
    name: text().notNull(),
    collectsSalesTax: boolean().notNull().default(true),
  },
  (table) => [uniqueIndex("pack_states_uidx").on(table.packId, table.code)],
);

/** A way a pack taxes things, such as how installation labor is treated per state. */
export const packTaxModels = pgTable(
  "pack_tax_models",
  {
    ...business(),
    packId: uuid()
      .notNull()
      .references(() => countryPacks.id),
    key: text().notNull(),
    description: text().notNull(),
    rules: jsonb().notNull(),
  },
  (table) => [uniqueIndex("pack_tax_models_uidx").on(table.packId, table.key)],
);
