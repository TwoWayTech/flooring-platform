import type { ProductCategory, SellUnit } from "@workspace/shared";
import { jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { business, quantity, unitCost } from "../columns";
import { suppliers } from "./purchasing";

/**
 * A catalog product (spec inventory.md). Every area good is priced and costed per sq ft and
 * stocked in sq ft, sold in whole cartons (ADR 0027). Broadloom rolls carry their width in ft.
 * Brands and categories are plain values here, not tables (data-model.md, Catalog).
 */
export const products = pgTable(
  "products",
  {
    ...business(),
    sku: text().notNull(),
    name: text().notNull(),
    brand: text().notNull().default(""),
    collection: text().notNull().default(""),
    colorName: text().notNull().default(""),
    swatch: text().notNull().default(""),
    category: text().$type<ProductCategory>().notNull(),
    unit: text().$type<SellUnit>().notNull(),
    price: unitCost().notNull(),
    /** Sensitive: shown only with view_sensitive (CLAUDE.md, permissions). */
    cost: unitCost().notNull(),
    sqFtPerCarton: quantity(),
    reorderPoint: quantity(),
    widthFt: quantity(),
    attributes: jsonb().$type<Record<string, string>>().notNull().default({}),
    supplierId: uuid().references(() => suppliers.id),
    externalId: text(),
  },
  (table) => [uniqueIndex("products_sku_uidx").on(table.sku)],
);
