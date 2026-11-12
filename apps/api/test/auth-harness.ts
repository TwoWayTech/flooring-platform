import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { openControlDb, type ControlDb, type DbHandle } from "@workspace/db";
import { account, member, organization, tenantBranding, tenants, user } from "@workspace/db/control";
import { seededTenantId, seedTestCompany } from "@workspace/db/seed";
import { scratchDatabase } from "@workspace/db/testing";
import { MemoryEmailProvider, NoopProvisioner } from "@workspace/providers";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
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

/**
 * An API on throwaway control and company databases with Summit Floor Co. seeded and every
 * seeded user given PASSWORD. Each harness has its own databases, so tests never share state with
 * the developer's databases.
 */
export class AuthHarness {
  app!: INestApplication;
  control!: DbHandle<ControlDb>;
  private readonly scratch: { url: string; drop: () => Promise<void> }[] = [];

  /** Creates the databases, seeds Summit and starts the app. */
  async start(): Promise<void> {
    this.scratch.push(await scratchDatabase("auth_control"), await scratchDatabase("auth_company"));
    const encryptionKey = randomBytes(32).toString("base64");
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
      CORS_ORIGINS: WEB_ORIGIN,
      EMAIL_PROVIDER: "memory",
      NODE_ENV: "test",
    });
    this.app = await createApp();
    await this.app.init();
    this.control = openControlDb(this.scratch[0].url, { max: 1 });
  }

  /** Stops the app and drops the databases. */
  async stop(): Promise<void> {
    await this.app?.close();
    await this.control?.close();
    for (const database of this.scratch) await database.drop();
  }

  /** The emails the API has "sent" through the memory adapter. */
  get outbox(): MemoryEmailProvider {
    return this.app.get<MemoryEmailProvider>(EMAIL);
  }

  /** A request as the web app's proxy sends it, from the given browser host. */
  post(path: string, host = "localhost:3000") {
    return request(this.app.getHttpServer()).post(path).set("Origin", WEB_ORIGIN).set("X-Forwarded-Host", host);
  }

  /** A GET request as the web app's proxy sends it. */
  get(path: string, host = "localhost:3000") {
    return request(this.app.getHttpServer()).get(path).set("Origin", WEB_ORIGIN).set("X-Forwarded-Host", host);
  }

  /** Signs in and returns the session cookie, or fails the test with Better Auth's answer. */
  async signIn(email: string, host?: string): Promise<string> {
    const response = await this.post("/api/auth/sign-in/email", host).send({ email, password: PASSWORD });
    if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
    return sessionCookie(response.headers["set-cookie"]);
  }

  /** The email of one seeded Summit user. */
  async summitEmail(): Promise<string> {
    const [row] = await this.control.db
      .select({ email: user.email })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(eq(member.organizationId, SUMMIT_ID))
      .limit(1);
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
  async addUser(options: { companyIds: string[]; verified?: boolean }): Promise<string> {
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
      await this.control.db
        .insert(member)
        .values({ id: uuidv7(), organizationId, userId: id, role: "member", createdAt: now });
    }
    return email;
  }
}

/** The Better Auth session cookie from a Set-Cookie header, ready to send back. */
export function sessionCookie(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const session = cookies.find((cookie) => cookie.includes("session_token="));
  if (!session) throw new Error("No session cookie was set.");
  return session.split(";")[0];
}

/** Whether an id is a UUID version 7. */
export function isUuidV7(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
