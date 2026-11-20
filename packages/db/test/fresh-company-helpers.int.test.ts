import { createHash, randomBytes } from "node:crypto";
import { companyDatabaseName, PostgresServerProvisioner } from "@workspace/providers";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateAllCompanies, migrateControl, openControlDb, type ControlDb, type DbHandle } from "../src";
import {
  account,
  member,
  passkey,
  session,
  tenantDatabases,
  tenants,
  twoFactor,
  user,
  userInvitations,
} from "../src/control";
import {
  adminUrl,
  inviteTestOwner,
  provisionTestCompany,
  retireTestCompany,
  scratchDatabase,
  sweepTestCompanies,
  type FreshTestServer,
} from "../src/testing";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A fresh slug and Owner email unique to this run, so runs never collide on the shared server. */
function freshNames(tag: string): { slug: string; ownerEmail: string } {
  const run = `${tag}${randomBytes(4).toString("hex")}`;
  return { slug: `e2efresh${run}`, ownerEmail: `owner.${run}@fresh.e2e.example` };
}

/** The SHA-256 a token's invitation row must hold, computed here on its own. */
function sha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// The test-only helpers that provision, invite and retire a throwaway company on the api-mode e2e
// database (whole-product check, plan section 5.3; ADR 0058). They run here against a scratch
// control database on the local server, as provision-tenant.int.test.ts does.
describe("fresh-company test helpers (needs the local PostgreSQL)", () => {
  const made: string[] = [];
  const encryptionKey = randomBytes(32).toString("base64");
  let control: { url: string; drop: () => Promise<void> };
  let handle: DbHandle<ControlDb>;
  let admin: DbHandle<ControlDb>;
  let server: FreshTestServer;

  /** Provisions a flooring company through the helper and remembers it for the clean-up. */
  async function provision(tag: string) {
    const names = freshNames(tag);
    made.push(names.slug);
    const created = await provisionTestCompany(server, { ...names, products: ["flooring"] });
    return { ...names, ...created };
  }

  /** Whether the server has a database with this name. */
  async function databaseExists(name: string): Promise<boolean> {
    const rows = await admin.db.execute(sql`select 1 from pg_database where datname = ${name}`);
    return rows.length > 0;
  }

  /** Both soft-delete stamps of a company: `tenants` and `tenant_databases`. */
  async function deletedStamps(tenantId: string): Promise<{ tenant: boolean; database: boolean }> {
    const [row] = await handle.db
      .select({ tenant: tenants.deletedAt, database: tenantDatabases.deletedAt })
      .from(tenants)
      .innerJoin(tenantDatabases, eq(tenantDatabases.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId));
    return { tenant: row.tenant !== null, database: row.database !== null };
  }

  /** The sign-in rows a user has, per table (a credential account counts under `account`). */
  async function signInRows(userId: string) {
    const count = async (rows: Promise<unknown[]>) => (await rows).length;
    return {
      session: await count(handle.db.select({ id: session.id }).from(session).where(eq(session.userId, userId))),
      twoFactor: await count(
        handle.db.select({ id: twoFactor.id }).from(twoFactor).where(eq(twoFactor.userId, userId)),
      ),
      passkey: await count(handle.db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId))),
      account: await count(
        handle.db
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, userId), eq(account.providerId, "credential"))),
      ),
    };
  }

  /** Test data standing in for a sign-in: a credential, a session, an authenticator and a passkey. */
  async function addSignInRows(userId: string): Promise<void> {
    const now = new Date();
    await handle.db.insert(account).values({
      accountId: userId,
      providerId: "credential",
      userId,
      password: "test-only-not-a-password-hash",
      updatedAt: now,
    });
    await handle.db.insert(session).values({
      token: randomBytes(16).toString("hex"),
      expiresAt: new Date(now.getTime() + HOUR),
      updatedAt: now,
      userId,
    });
    await handle.db.insert(twoFactor).values({ secret: "test-only", backupCodes: "[]", userId });
    await handle.db.insert(passkey).values({
      publicKey: "test-only",
      credentialID: randomBytes(8).toString("hex"),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      userId,
    });
  }

  beforeAll(async () => {
    control = await scratchDatabase("fresh_control");
    await migrateControl(control.url);
    handle = openControlDb(control.url, { max: 1 });
    admin = openControlDb(adminUrl, { max: 1 });
    server = { controlUrl: control.url, adminUrl, encryptionKey };
  }, 60_000);

  afterAll(async () => {
    const provisioner = new PostgresServerProvisioner(adminUrl);
    for (const slug of made) await provisioner.drop(companyDatabaseName(slug));
    await handle?.close();
    await admin?.close();
    await control?.drop();
  });

  it("FH-1: provision, invite and retire; the retired company is gone everywhere migrate looks, and only its Owner loses sign-in", async () => {
    const retired = await provision("a");
    const live = await provision("b");
    expect(await databaseExists(companyDatabaseName(retired.slug))).toBe(true);

    const before = Date.now();
    const token = await inviteTestOwner(control.url, retired.slug);
    const invitations = await handle.db
      .select()
      .from(userInvitations)
      .where(eq(userInvitations.tenantId, retired.tenantId));
    expect(invitations).toHaveLength(1);
    const [invitation] = invitations;
    expect(invitation).toMatchObject({ userId: retired.ownerUserId, acceptedAt: null, revokedAt: null });
    expect(invitation.tokenHash).toBe(sha256(token));
    const expires = invitation.expiresAt.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 7 * DAY - 1_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 7 * DAY);
    await expect(inviteTestOwner(control.url, retired.slug)).rejects.toThrow(/already has an open invitation/);

    await addSignInRows(retired.ownerUserId);
    await addSignInRows(live.ownerUserId);
    expect(await signInRows(retired.ownerUserId)).toEqual({ session: 1, twoFactor: 1, passkey: 1, account: 1 });

    await retireTestCompany(server, retired.slug);
    expect(await databaseExists(companyDatabaseName(retired.slug))).toBe(false);
    // First what matters most (MF-1): `pnpm db:migrate` reads only tenant_databases.deleted_at, so it
    // must migrate the live company and never reach the dropped database. A live row there would stop
    // the rollout with an error and put the company in maintenance.
    const migrated = await migrateAllCompanies(handle.db, encryptionKey);
    expect(migrated.map((row) => row.tenantId)).toEqual([live.tenantId]);
    expect(await deletedStamps(retired.tenantId)).toEqual({ tenant: true, database: true });
    const [revoked] = await handle.db.select().from(userInvitations).where(eq(userInvitations.id, invitation.id));
    expect(revoked.revokedAt).not.toBeNull();
    expect(await signInRows(retired.ownerUserId)).toEqual({ session: 0, twoFactor: 0, passkey: 0, account: 0 });
    // The user and member rows stay, because the company's audit rows name them.
    expect(await handle.db.select({ id: user.id }).from(user).where(eq(user.id, retired.ownerUserId))).toHaveLength(1);
    expect(
      await handle.db.select({ id: member.id }).from(member).where(eq(member.organizationId, retired.tenantId)),
    ).toHaveLength(1);

    // The other company and its Owner are untouched.
    expect(await databaseExists(companyDatabaseName(live.slug))).toBe(true);
    expect(await deletedStamps(live.tenantId)).toEqual({ tenant: false, database: false });
    expect(await signInRows(live.ownerUserId)).toEqual({ session: 1, twoFactor: 1, passkey: 1, account: 1 });

    // Retiring again changes nothing and doesn't throw.
    await retireTestCompany(server, retired.slug);
    expect(await deletedStamps(retired.tenantId)).toEqual({ tenant: true, database: true });
  }, 60_000);

  it("FH-2: every helper refuses a demo company, a seeded user, a name outside its pattern, a remote host and another DB_PROVIDER, before it connects", async () => {
    const names = freshNames("c");
    const company = { ...names, products: ["flooring"] as const };
    const remote = "postgres://postgres:postgres@db.example.com:5432/control";
    const withOption = (option: string) => `${control.url}${control.url.includes("?") ? "&" : "?"}${option}`;
    const hostOverride = withOption("host=db.example.com");
    const countTenants = async () => (await handle.db.select({ id: tenants.id }).from(tenants)).length;
    const tenantsBefore = await countTenants();
    const refusals: [string, () => Promise<unknown>, RegExp][] = [
      ["provision summit", () => provisionTestCompany(server, { ...company, slug: "summit" }), /demo company summit/],
      ["provision a plain slug", () => provisionTestCompany(server, { ...company, slug: "freshco123" }), /e2efresh/],
      [
        "provision a seeded owner",
        () => provisionTestCompany(server, { ...company, ownerEmail: "dana.whitfield@summitfloor.example" }),
        /never touches a seeded user/,
      ],
      [
        "provision a plain owner",
        () => provisionTestCompany(server, { ...company, ownerEmail: "pat@example.test" }),
        /owner\.<run>@fresh\.e2e\.example/,
      ],
      [
        "provision on a remote server",
        () => provisionTestCompany({ ...server, adminUrl: remote }, company),
        /this machine.*adminUrl/,
      ],
      [
        "provision with a host override",
        () => provisionTestCompany({ ...server, controlUrl: hostOverride }, company),
        /this machine.*controlUrl/,
      ],
      [
        "provision with a port override",
        () => provisionTestCompany({ ...server, controlUrl: withOption("port=5999") }, company),
        /this machine.*controlUrl/,
      ],
      [
        "provision with a fragment",
        () =>
          provisionTestCompany(
            { ...server, adminUrl: "postgres://postgres:postgres@localhost:5432#@db.example.com:5432/x" },
            company,
          ),
        /this machine.*adminUrl/,
      ],
      [
        "provision with an http: URL whose host WHATWG rewrites to 127.0.0.1",
        () =>
          provisionTestCompany({ ...server, adminUrl: "http://postgres:postgres@0177.0.0.1:5432/postgres" }, company),
        /this machine.*adminUrl/,
      ],
      [
        "provision with a tab before the authority",
        () =>
          provisionTestCompany(
            { ...server, adminUrl: "postgres:\t//postgres:postgres@localhost:5432/x://db.example.com:5432/postgres" },
            company,
          ),
        /this machine.*adminUrl/,
      ],
      ["invite summit", () => inviteTestOwner(control.url, "summit"), /demo company summit/],
      ["invite on a remote server", () => inviteTestOwner(remote, names.slug), /this machine/],
      ["retire summit", () => retireTestCompany(server, "summit"), /demo company summit/],
      ["retire keystone", () => retireTestCompany(server, "keystone"), /demo company keystone/],
      ["retire a plain slug", () => retireTestCompany(server, "prairie"), /e2efresh/],
      [
        "retire on a remote server",
        () => retireTestCompany({ ...server, controlUrl: remote }, names.slug),
        /this machine/,
      ],
      ["sweep on a remote server", () => sweepTestCompanies({ ...server, adminUrl: remote }, 2 * HOUR), /this machine/],
      ["sweep too young", () => sweepTestCompanies(server, 60_000), /10 minutes or more/],
    ];
    for (const [label, call, message] of refusals) await expect(call(), label).rejects.toThrow(message);

    const provider = process.env.DB_PROVIDER;
    process.env.DB_PROVIDER = "neon";
    try {
      const calls: [string, () => Promise<unknown>][] = [
        ["provision", () => provisionTestCompany(server, company)],
        ["invite", () => inviteTestOwner(control.url, names.slug)],
        ["retire", () => retireTestCompany(server, names.slug)],
        ["sweep", () => sweepTestCompanies(server, 2 * HOUR)],
      ];
      for (const [label, call] of calls) await expect(call(), label).rejects.toThrow(/DB_PROVIDER unset or postgres/);
    } finally {
      if (provider === undefined) delete process.env.DB_PROVIDER;
      else process.env.DB_PROVIDER = provider;
    }
    expect(await countTenants(), "nothing was written").toBe(tenantsBefore);
    expect(await databaseExists(companyDatabaseName(names.slug))).toBe(false);
  }, 60_000);

  it("FH-3: the sweep retires only fresh companies older than its threshold, and nothing a pattern doesn't match", async () => {
    const old = await provision("d");
    const young = await provision("e");
    await handle.db
      .update(tenants)
      .set({ createdAt: new Date(Date.now() - 3 * HOUR) })
      .where(eq(tenants.id, old.tenantId));
    // Old companies the helpers never made: a plain slug, and an e2efresh slug too short for FRESH_SLUG.
    const strangers = [`plainold${randomBytes(3).toString("hex")}`, `e2efresh${randomBytes(2).toString("hex")}`];
    const inserted = await handle.db
      .insert(tenants)
      .values(
        strangers.map((slug) => ({
          slug,
          legalName: "Old Stranger LLC",
          name: "Old Stranger",
          state: "CO",
          timeZone: "America/Denver",
          createdAt: new Date(Date.now() - 3 * HOUR),
        })),
      )
      .returning({ id: tenants.id });

    expect(await sweepTestCompanies(server, 2 * HOUR)).toEqual([old.slug]);
    expect(await deletedStamps(old.tenantId)).toEqual({ tenant: true, database: true });
    expect(await databaseExists(companyDatabaseName(old.slug))).toBe(false);
    expect(await deletedStamps(young.tenantId)).toEqual({ tenant: false, database: false });
    expect(await databaseExists(companyDatabaseName(young.slug))).toBe(true);
    const others = await handle.db
      .select({ deletedAt: tenants.deletedAt })
      .from(tenants)
      .where(
        inArray(
          tenants.id,
          inserted.map((row) => row.id),
        ),
      );
    expect(others).toEqual([{ deletedAt: null }, { deletedAt: null }]);
    expect(await sweepTestCompanies(server, 2 * HOUR), "nothing is left to sweep").toEqual([]);
  }, 60_000);

  it("FH-4: the sweep drops a retired fresh company's leftover database and leaves a stranger's, and one company it can't retire doesn't stop the others", async () => {
    const age = new Date(Date.now() - 3 * HOUR);
    // Retired, but its drop never ran: both stamps set, the database still there.
    const orphan = await provision("f");
    await handle.db.update(tenants).set({ createdAt: age, deletedAt: age }).where(eq(tenants.id, orphan.tenantId));
    await handle.db
      .update(tenantDatabases)
      .set({ deletedAt: age })
      .where(eq(tenantDatabases.tenantId, orphan.tenantId));
    // A live company in the fresh pattern with no Owner: retirement refuses it.
    const ownerless = freshNames("g");
    await handle.db.insert(tenants).values({
      slug: ownerless.slug,
      legalName: "Ownerless LLC",
      name: "Ownerless",
      state: "CO",
      timeZone: "America/Denver",
      createdAt: age,
    });
    // A retired company the helpers never made (outside FRESH_SLUG), whose database must survive.
    const stranger = `e2efresh_${randomBytes(2).toString("hex")}`;
    await handle.db.insert(tenants).values({
      slug: stranger,
      legalName: "Retired Stranger LLC",
      name: "Retired Stranger",
      state: "CO",
      timeZone: "America/Denver",
      createdAt: age,
      deletedAt: age,
    });
    await admin.db.execute(sql.raw(`create database "${companyDatabaseName(stranger)}"`));
    try {
      const old = await provision("h");
      await handle.db.update(tenants).set({ createdAt: age }).where(eq(tenants.id, old.tenantId));
      expect(await databaseExists(companyDatabaseName(orphan.slug))).toBe(true);

      await expect(sweepTestCompanies(server, 2 * HOUR)).rejects.toThrow(
        new RegExp(`^sweepTestCompanies could not finish:\\n${ownerless.slug}: `),
      );
      expect(await deletedStamps(old.tenantId), "retired despite the failure").toEqual({
        tenant: true,
        database: true,
      });
      expect(await databaseExists(companyDatabaseName(old.slug))).toBe(false);
      expect(await databaseExists(companyDatabaseName(orphan.slug)), "the leftover database is dropped").toBe(false);
      expect(await databaseExists(companyDatabaseName(stranger)), "a stranger's database is left alone").toBe(true);
    } finally {
      await admin.db.execute(sql.raw(`drop database if exists "${companyDatabaseName(stranger)}"`));
      await handle.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.slug, ownerless.slug));
    }
  }, 60_000);
});
