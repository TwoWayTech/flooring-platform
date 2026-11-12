import type { CompanyStatus, FloorPattern } from "@workspace/shared";
import { boolean, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business } from "../columns";

/** Where a company stands; `cancelled` is the blueprint's fifth state, kept read-only for 90 days (p29). */
export type TenantStatus = CompanyStatus | "cancelled";

/**
 * A company on the platform (blueprint "Multi-tenancy"). The subdomain picks the company at
 * sign-in; the time zone and US state drive dates and the country pack.
 */
export const tenants = pgTable(
  "tenants",
  {
    ...business(),
    slug: text().notNull(),
    legalName: text().notNull(),
    name: text().notNull(),
    city: text().notNull().default(""),
    state: text().notNull(),
    status: text().$type<TenantStatus>().notNull().default("trial"),
    timeZone: text().notNull(),
    region: text().notNull().default("us"),
    /** Read-only while the company is moved between providers (blueprint p12). */
    maintenanceMode: boolean().notNull().default(false),
  },
  (table) => [uniqueIndex("tenants_slug_uidx").on(table.slug)],
);

/** How a company database is reached: written by provisioning, read by the connection manager (P9). */
export type TenantDatabaseStatus = "provisioning" | "ready" | "migrating" | "failed" | "read_only";

/**
 * The company's own database (blueprint "tenant_databases"). The connection string is stored only
 * encrypted with AES-256-GCM (blueprint "Security": secrets); schema_version is the last company
 * migration it ran, so the runner can stop and report a company that fails.
 */
export const tenantDatabases = pgTable(
  "tenant_databases",
  {
    ...business(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    provider: text().notNull(),
    providerRef: text().notNull(),
    encryptedUrl: text().notNull(),
    schemaVersion: text(),
    migratedAt: at(),
    status: text().$type<TenantDatabaseStatus>().notNull().default("provisioning"),
    lastError: text(),
  },
  (table) => [uniqueIndex("tenant_databases_tenant_uidx").on(table.tenantId)],
);

/**
 * Branding shown before sign-in, so it lives here and not in the company database (blueprint
 * "Branding and settings"). Logo and favicon are storage keys, never data URLs.
 */
export const tenantBranding = pgTable(
  "tenant_branding",
  {
    ...business(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    displayName: text().notNull(),
    monogram: text().notNull(),
    brandColor: text().notNull(),
    pattern: text().$type<FloorPattern>().notNull(),
    logoKey: text(),
    logoDarkKey: text(),
    faviconKey: text(),
    defaultTheme: text().$type<"light" | "dark" | "system">().notNull().default("system"),
    /** Idle and absolute session timeouts in minutes, set per company (blueprint "Security"). */
    idleTimeoutMin: integer().notNull().default(30),
    absoluteTimeoutMin: integer().notNull().default(720),
  },
  (table) => [uniqueIndex("tenant_branding_tenant_uidx").on(table.tenantId)],
);
