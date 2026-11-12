import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as companySchema from "./company";
import * as controlSchema from "./control";

/** A Drizzle client on the control database. */
export type ControlDb = PostgresJsDatabase<typeof controlSchema>;
/** A Drizzle client on one company's database. */
export type CompanyDb = PostgresJsDatabase<typeof companySchema>;

/** A database client with the pool behind it, which the owner closes when done. */
export interface DbHandle<T> {
  db: T;
  close(): Promise<void>;
}

/** Pool settings; the defaults suit one API instance and keep a laptop's memory low. */
export interface PoolOptions {
  max?: number;
}

function pool(url: string, options: PoolOptions) {
  // Plain TCP driver with a pooled URL; never a provider-only driver (blueprint "Provider portability", rule 2).
  return postgres(url, { max: options.max ?? 5, onnotice: () => undefined });
}

/** Opens the control database. */
export function openControlDb(url: string, options: PoolOptions = {}): DbHandle<ControlDb> {
  const client = pool(url, options);
  return { db: drizzle(client, { schema: controlSchema, casing: "snake_case" }), close: () => client.end() };
}

/**
 * Opens one company's database. Callers outside packages/db get here only through the API's
 * TenantConnectionService, with the company from the verified session (CLAUDE.md rule 1, P9).
 */
export function openCompanyDb(url: string, options: PoolOptions = {}): DbHandle<CompanyDb> {
  const client = pool(url, options);
  return { db: drizzle(client, { schema: companySchema, casing: "snake_case" }), close: () => client.end() };
}
