import { randomBytes } from "node:crypto";
import postgres from "postgres";
import type { DatabaseProvisioner, ProvisionRequest, ProvisionedDatabase } from "./types";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

/** The database and role name for a company; also its provider reference. */
export function companyDatabaseName(slug: string): string {
  const name = `company_${slug}`;
  if (!IDENTIFIER.test(name)) throw new Error(`"${slug}" cannot name a database: use a-z, 0-9 and _.`);
  return name;
}

/**
 * One database and one login role per company on a shared PostgreSQL server (blueprint "Provider
 * portability": AWS RDS, Azure, Cloud SQL or self-hosted, and the local docker-compose server).
 * Cost stays flat because companies share the server; each role can reach only its own database.
 */
export class PostgresServerProvisioner implements DatabaseProvisioner {
  /** @param adminUrl A superuser login on the server, used only for CREATE and DROP. */
  constructor(private readonly adminUrl: string) {}

  /**
   * Creates the role with a random password, then the database it owns, closed to everyone else.
   * If the database cannot be created, the new role is removed again, so a retry starts clean.
   */
  async create({ slug }: ProvisionRequest): Promise<ProvisionedDatabase> {
    const name = companyDatabaseName(slug);
    const password = randomBytes(24).toString("hex");
    await this.admin(async (sql) => {
      // DDL cannot take bind parameters; the name is checked against IDENTIFIER and the password is hex.
      await sql.unsafe(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}'`);
      try {
        await sql.unsafe(`CREATE DATABASE "${name}" OWNER "${name}"`);
      } catch (error) {
        await sql.unsafe(`DROP ROLE IF EXISTS "${name}"`);
        throw error;
      }
      await sql.unsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    });
    return { providerRef: name, connectionUrl: this.urlFor(name, password) };
  }

  /** Drops the database (closing its connections) and then its role. */
  async drop(providerRef: string): Promise<void> {
    if (!IDENTIFIER.test(providerRef)) throw new Error(`"${providerRef}" is not a company database name.`);
    await this.admin(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS "${providerRef}" WITH (FORCE)`);
      await sql.unsafe(`DROP ROLE IF EXISTS "${providerRef}"`);
    });
  }

  private async admin(work: (sql: postgres.Sql) => Promise<void>): Promise<void> {
    const sql = postgres(this.adminUrl, { max: 1, onnotice: () => undefined });
    try {
      await work(sql);
    } finally {
      await sql.end();
    }
  }

  private urlFor(name: string, password: string): string {
    const url = new URL(this.adminUrl);
    url.username = name;
    url.password = password;
    url.pathname = `/${name}`;
    return url.toString();
  }
}
