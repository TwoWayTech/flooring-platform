import type { ModuleKey, ProductKey } from "@workspace/shared";
import { boolean, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business, money } from "../columns";
import { tenants } from "./tenants";

/** The two products sold from one codebase: Flooring Suite and HR Suite (blueprint p3). */
export const products = pgTable(
  "products",
  {
    ...business(),
    key: text().$type<ProductKey>().notNull(),
    name: text().notNull(),
  },
  (table) => [uniqueIndex("products_key_uidx").on(table.key)],
);

/** Which products a company subscribes to. */
export const tenantProducts = pgTable(
  "tenant_products",
  {
    ...business(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
  },
  (table) => [uniqueIndex("tenant_products_uidx").on(table.tenantId, table.productId)],
);

/** A plan a company can be on (blueprint "Subscriptions and billing"). */
export const plans = pgTable(
  "plans",
  {
    ...business(),
    key: text().notNull(),
    name: text().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    monthlyPrice: money().notNull(),
    yearlyPrice: money().notNull(),
    active: boolean().notNull().default(true),
  },
  (table) => [uniqueIndex("plans_key_uidx").on(table.key)],
);

/** The modules a plan switches on; `platform` is always on and needs no row. */
export const planModules = pgTable(
  "plan_modules",
  {
    ...business(),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    module: text().$type<ModuleKey>().notNull(),
  },
  (table) => [uniqueIndex("plan_modules_uidx").on(table.planId, table.module)],
);

/** Limits that come with a plan. */
export const planLimits = pgTable(
  "plan_limits",
  {
    ...business(),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    maxUsers: integer().notNull(),
    maxBranches: integer().notNull(),
  },
  (table) => [uniqueIndex("plan_limits_plan_uidx").on(table.planId)],
);

/** A company's subscription. A payment processor's webhook updates it, never the browser (blueprint p23). */
export const tenantSubscriptions = pgTable("tenant_subscriptions", {
  ...business(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
  planId: uuid()
    .notNull()
    .references(() => plans.id),
  interval: text().$type<"monthly" | "yearly">().notNull(),
  price: money().notNull(),
  currentPeriodStart: at().notNull(),
  currentPeriodEnd: at().notNull(),
  status: text().$type<"trial" | "active" | "past_due" | "cancelled">().notNull(),
  /** Limits set for this company outside its plan; null follows the plan. */
  userLimitOverride: integer(),
  branchLimitOverride: integer(),
});

/** A module switched on or off for one company outside its plan. */
export const tenantModuleOverrides = pgTable(
  "tenant_module_overrides",
  {
    ...business(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    module: text().$type<ModuleKey>().notNull(),
    enabled: boolean().notNull(),
  },
  (table) => [uniqueIndex("tenant_module_overrides_uidx").on(table.tenantId, table.module)],
);
