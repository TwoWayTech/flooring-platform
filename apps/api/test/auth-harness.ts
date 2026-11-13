import { randomBytes } from "node:crypto";
import type { INestApplication, Type } from "@nestjs/common";
import {
  decryptSecret,
  openCompanyDb,
  openControlDb,
  provisionTenant,
  type CompanyDb,
  type ControlDb,
  type DbHandle,
} from "@workspace/db";
import { account, member, organization, tenantBranding, tenantDatabases, tenants, user } from "@workspace/db/control";
import { seededTenantId, seedTestCompany } from "@workspace/db/seed";
import { adminUrl, scratchDatabase } from "@workspace/db/testing";
import {
  companyDatabaseName,
  MemoryEmailProvider,
  NoopProvisioner,
  PostgresServerProvisioner,
} from "@workspace/providers";
import { hashPassword } from "better-auth/crypto";
import { decodeMemberRoles, encodeMemberRoles, rolesRequireMfa, type ProductKey } from "@workspace/shared";
import { roles, userProfiles, userRoles } from "@workspace/db/company";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { createApp } from "../src/app";
import { EMAIL } from "../src/core/email/email.module";

/** The web origin and host the tests pretend to be; the web app's proxy forwards the host. */
export const WEB_ORIGIN = "http://localhost:3000";

/** A password long enough for the 12-character rule, shared by every test user. */
export const PASSWORD = `pw-${randomBytes(12).toString("base64url")}`;

/** Summit Floor Co.'s tenant id, as seeded. */
export const SUMMIT_ID = seededTenantId("summit");

/** The shared secret the web proxy sends, so the API trusts the forwarded client IP (client-ip.ts). */
export const PROXY_SECRET = randomBytes(32).toString("base64url");

/**
 * An API on throwaway control and company databases with Summit Floor Co. seeded and every
 * seeded user given PASSWORD. Each harness has its own databases, so tests never share state with
 * the developer's databases.
 */
export class AuthHarness {
  app!: INestApplication;
  control!: DbHandle<ControlDb>;
  private readonly scratch: { url: string; drop: () => Promise<void> }[] = [];
  /** Company databases made with provisionCompany, dropped by stop(). */
  private readonly provisioned: string[] = [];
  private encryptionKey = "";

  /**
   * Creates the databases, seeds Summit and starts the app. `modules` mounts test-only controllers,
   * such as the isolation probe.
   */
  async start(modules: readonly Type[] = []): Promise<void> {
    this.scratch.push(await scratchDatabase("auth_control"), await scratchDatabase("auth_company"));
    const encryptionKey = randomBytes(32).toString("base64");
    this.encryptionKey = encryptionKey;
    await seedTestCompany({
      controlUrl: this.scratch[0].url,
      encryptionKey,
      provisioner: new NoopProvisioner(this.scratch[1].url),
      provider: "noop",
      userPassword: PASSWORD,
    });
    Object.assign(process.env, {
      CONTROL_DATABASE_URL: this.scratch[0].url,
      CONNECTION_ENCRYPTION_KEY: encryptionKey,
      TENANT_DB_ADMIN_URL: this.scratch[0].url,
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
      AUTH_ALLOWED_HOSTS: "localhost:*,*.flooringsuite.test",
      AUTH_PROXY_SECRET: PROXY_SECRET,
      CORS_ORIGINS: WEB_ORIGIN,
      EMAIL_PROVIDER: "memory",
      NODE_ENV: "test",
    });
    this.app = await createApp(modules);
    await this.app.init();
    this.control = openControlDb(this.scratch[0].url, { max: 1 });
  }

  /** Stops the app and drops the databases. */
  async stop(): Promise<void> {
    await this.app?.close();
    await this.control?.close();
    const provisioner = new PostgresServerProvisioner(adminUrl);
    for (const slug of this.provisioned) await provisioner.drop(companyDatabaseName(slug));
    for (const database of this.scratch) await database.drop();
  }

  /**
   * Provisions a company the real way, with a database of its own on the local server (P9), and
   * returns its tenant id. The slug gets a suffix unique to this run.
   */
  async provisionCompany(
    name: string,
    products: readonly ProductKey[] = ["flooring"],
  ): Promise<{ id: string; slug: string }> {
    const slug = `${name}${process.pid}${randomBytes(2).toString("hex")}`.replace(/[^a-z0-9]/g, "");
    const result = await provisionTenant(
      this.control.db,
      new PostgresServerProvisioner(adminUrl),
      this.encryptionKey,
      "postgres",
      {
        slug,
        name,
        legalName: `${name} LLC`,
        state: "TX",
        timeZone: "America/Chicago",
        products,
        owner: { name: "Owner", email: `owner-${slug}@example.test` },
      },
    );
    this.provisioned.push(slug);
    return { id: result.tenantId, slug };
  }

  /** Opens a company database directly, to set up or check rows behind the API's back. */
  async companyDb(companyId: string): Promise<DbHandle<CompanyDb>> {
    const [row] = await this.control.db
      .select({ encryptedUrl: tenantDatabases.encryptedUrl })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, companyId));
    return openCompanyDb(decryptSecret(row.encryptedUrl, this.encryptionKey), { max: 1 });
  }

  /** The user id of a test user's email. */
  async userIdOf(email: string): Promise<string> {
    const [row] = await this.control.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    return row.id;
  }

  /** The emails the API has "sent" through the memory adapter. */
  get outbox(): MemoryEmailProvider {
    return this.app.get<MemoryEmailProvider>(EMAIL);
  }

  /**
   * A request as the web app's proxy sends it, from the given browser host. Each request comes
   * from its own client IP unless one is given, so the per-IP limits only meet in tests about them.
   */
  post(path: string, host = "localhost:3000", ip = randomIp()) {
    return request(this.app.getHttpServer())
      .post(path)
      .set("Origin", WEB_ORIGIN)
      .set("X-Forwarded-Host", host)
      .set("X-Client-IP", ip)
      .set("X-Proxy-Secret", PROXY_SECRET);
  }

  /** A GET request as the web app's proxy sends it. */
  get(path: string, host = "localhost:3000", ip = randomIp()) {
    return request(this.app.getHttpServer())
      .get(path)
      .set("Origin", WEB_ORIGIN)
      .set("X-Forwarded-Host", host)
      .set("X-Client-IP", ip)
      .set("X-Proxy-Secret", PROXY_SECRET);
  }

  /** Signs in and returns the session cookie, or fails the test with Better Auth's answer. */
  async signIn(email: string, host?: string): Promise<string> {
    const response = await this.post("/api/auth/sign-in/email", host).send({ email, password: PASSWORD });
    if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
    return sessionCookie(response.headers["set-cookie"]);
  }

  /**
   * The email of one seeded Summit user. By default one whose roles do not require MFA, so tests
   * about other rules sign straight in; `{ mfaRequired: true }` picks one whose roles do.
   */
  async summitEmail(options: { mfaRequired?: boolean } = {}): Promise<string> {
    const rows = await this.control.db
      .select({ email: user.email, role: member.role })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(eq(member.organizationId, SUMMIT_ID))
      .orderBy(user.email);
    const wanted = options.mfaRequired ?? false;
    const row = rows.find((candidate) => rolesRequireMfa(decodeMemberRoles(candidate.role)) === wanted);
    if (!row) throw new Error("No seeded Summit user fits.");
    return row.email;
  }

  /** Adds a company with an organization and, optionally, its own timeouts. Returns its id. */
  async addCompany(slug: string, timeouts?: { idleMin: number; absoluteMin: number }): Promise<string> {
    const id = uuidv7();
    await this.control.db
      .insert(tenants)
      .values({ id, slug, legalName: `${slug} LLC`, name: slug, state: "CO", timeZone: "America/Denver" });
    await this.control.db.insert(organization).values({ id, name: slug, slug, createdAt: new Date() });
    if (timeouts) {
      await this.control.db.insert(tenantBranding).values({
        tenantId: id,
        displayName: slug,
        monogram: "T",
        brandColor: "#336699",
        pattern: "herringbone",
        idleTimeoutMin: timeouts.idleMin,
        absoluteTimeoutMin: timeouts.absoluteMin,
      });
    }
    return id;
  }

  /** Adds a user with PASSWORD and the given memberships. Returns the email. */
  async addUser(options: { companyIds: string[]; verified?: boolean; roles?: string[] }): Promise<string> {
    const id = uuidv7();
    const email = `user-${id}@example.test`;
    const now = new Date();
    await this.control.db
      .insert(user)
      .values({ id, name: "Test User", email, emailVerified: options.verified ?? true });
    await this.control.db.insert(account).values({
      id: uuidv7(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(PASSWORD),
      updatedAt: now,
    });
    for (const organizationId of options.companyIds) {
      await this.control.db.insert(member).values({
        id: uuidv7(),
        organizationId,
        userId: id,
        role: encodeMemberRoles(options.roles ?? ["sales"]),
        createdAt: now,
      });
      await this.grantRoles(organizationId, id, options.roles ?? ["sales"]);
    }
    return email;
  }

  /**
   * Gives a user an active profile and the roles with these keys in a company's own database, as
   * Settings → Users will (P10). Companies made with addCompany have no database, so they are skipped.
   */
  async grantRoles(companyId: string, userId: string, roleKeys: readonly string[]): Promise<void> {
    const [database] = await this.control.db
      .select({ id: tenantDatabases.id })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, companyId));
    if (!database) return;
    const handle = await this.companyDb(companyId);
    try {
      await handle.db.insert(userProfiles).values({ userId, status: "active" }).onConflictDoNothing();
      const held = await handle.db
        .select({ id: roles.id })
        .from(roles)
        .where(inArray(roles.key, [...roleKeys]));
      if (held.length > 0) {
        await handle.db
          .insert(userRoles)
          .values(held.map((role) => ({ userId, roleId: role.id })))
          .onConflictDoNothing();
      }
    } finally {
      await handle.close();
    }
  }
}

/** The Better Auth session cookie from a Set-Cookie header, ready to send back. */
export function sessionCookie(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const session = cookies.find((cookie) => cookie.includes("session_token="));
  if (!session) throw new Error("No session cookie was set.");
  return session.split(";")[0];
}

/** A random client IP in 198.51.0.0/16, one per request by default (tests only). */
export function randomIp(): string {
  const [a, b] = randomBytes(2);
  return `198.51.${a}.${b}`;
}

/** Whether an id is a UUID version 7. */
export function isUuidV7(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
