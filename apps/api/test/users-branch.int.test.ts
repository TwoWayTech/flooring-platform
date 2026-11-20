import { auditLog, branches, rolePermissions, roles, userProfiles } from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** A TOTP code for the next 30-second step, so a code is never used twice in one step. */
function freshCode(secret: string): string {
  return totpCode(secret, new Date(Date.now() + 30_000));
}

/**
 * Invite branches on the server (the server half of D18; ADR 0051, "2026-11-20"): an unknown
 * branch is refused, the audit row records the stored branch, and a branch-scoped admin invites
 * into, and moves people within, their own branch only.
 */
describe("invite branches (ADR 0051 2026-11-20, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let owner = { email: "", cookie: "", secret: "", userId: "" };
  let branchAdmin = { email: "", cookie: "", secret: "", userId: "" };
  const north = uuidv7();
  const south = uuidv7();
  let helperRoleId = "";

  function call(method: "get" | "post" | "patch", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    expect(confirmed.status).toBe(200);
    const cookie = sessionCookie(confirmed.headers["set-cookie"]);
    const me = await call("get", "/users", cookie);
    const userId = (me.body as { id: string; email: string }[]).find((row) => row.email === email)?.id ?? "";
    return { email, cookie, secret, userId };
  }

  async function stepUp(who: { cookie: string; secret: string }) {
    await harness
      .post("/auth/step-up")
      .set("Cookie", who.cookie)
      .send({ code: freshCode(who.secret) })
      .expect(204);
  }

  async function withCompanyDb<T>(work: (db: Awaited<ReturnType<AuthHarness["companyDb"]>>["db"]) => Promise<T>) {
    const handle = await harness.companyDb(company.id);
    try {
      return await work(handle.db);
    } finally {
      await handle.close();
    }
  }

  async function storedBranch(userId: string): Promise<string | null> {
    return withCompanyDb(async (db) => {
      const [row] = await db
        .select({ branchId: userProfiles.branchId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId));
      return row?.branchId ?? null;
    });
  }

  function invite(cookie: string, branchId: string, tag: string) {
    return call("post", "/users/invite", cookie).send({
      name: `Branch ${tag}`,
      email: `branch-${tag}-${Date.now()}@example.test`,
      title: "",
      roleIds: [helperRoleId],
      branchId,
    });
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("branches");
    await withCompanyDb(async (db) => {
      await db.insert(branches).values([
        { id: north, name: "North", city: "Northtown", state: "CO" },
        { id: south, name: "South", city: "Southtown", state: "CO" },
      ]);
      const [admin] = await db
        .insert(roles)
        .values({ key: "branch_admin", name: "Branch admin", dataScope: "branch" })
        .returning({ id: roles.id });
      await db.insert(rolePermissions).values([
        { roleId: admin.id, permissionKey: "settings.users.view" },
        { roleId: admin.id, permissionKey: "settings.users.manage" },
      ]);
      const [helper] = await db
        .insert(roles)
        .values({ key: "branch_helper", name: "Branch helper", dataScope: "own" })
        .returning({ id: roles.id });
      await db.insert(rolePermissions).values({ roleId: helper.id, permissionKey: "settings.users.view" });
      helperRoleId = helper.id;
    });
    owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    const adminEmail = await harness.addUser({ companyIds: [company.id], roles: ["branch_admin"] });
    branchAdmin = await enrolled(adminEmail);
    await withCompanyDb((db) =>
      db.update(userProfiles).set({ branchId: north }).where(eq(userProfiles.userId, branchAdmin.userId)),
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("IB1 refuses an unknown or malformed branch on an invitation, and stores nothing", async () => {
    await stepUp(owner);
    const unknown = await invite(owner.cookie, uuidv7(), "unknown");
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("unknown_branch");
    const malformed = await invite(owner.cookie, "br-north", "malformed");
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("unknown_branch");
    const listed = await call("get", "/users", owner.cookie).expect(200);
    expect(listed.body.some((row: { name: string }) => /^Branch (unknown|malformed)$/.test(row.name))).toBe(false);
  });

  it("IB2 refuses a deleted branch", async () => {
    const gone = uuidv7();
    await withCompanyDb((db) =>
      db.insert(branches).values({ id: gone, name: "Gone", city: "Nowhere", state: "CO", deletedAt: new Date() }),
    );
    await stepUp(owner);
    expect((await invite(owner.cookie, gone, "gone")).body.code).toBe("unknown_branch");
  });

  it("IB3 records the stored branch in the invite's audit row; empty stays no branch", async () => {
    await stepUp(owner);
    const placed = await invite(owner.cookie, south, "south").expect(201);
    expect(placed.body.branchId).toBe(south);
    const none = await invite(owner.cookie, "", "none").expect(201);
    expect(none.body.branchId).toBe("");
    const rows = await withCompanyDb((db) =>
      db
        .select({ targetId: auditLog.targetId, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.action, "Invited user")),
    );
    const afterOf = (id: string) =>
      rows.find((row) => row.targetId === id)?.after as { branchId: string | null } | undefined;
    expect(afterOf(placed.body.id)?.branchId).toBe(south);
    expect(afterOf(none.body.id)?.branchId).toBeNull();
  });

  it("IB4 refuses an unknown branch on a change, keeps the person's branch, and audits the stored one", async () => {
    await stepUp(owner);
    const person = await invite(owner.cookie, south, "move").expect(201);
    await stepUp(owner);
    const refused = await call("patch", `/users/${person.body.id}`, owner.cookie).send({ branchId: uuidv7() });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("unknown_branch");
    expect(await storedBranch(person.body.id)).toBe(south);
    await stepUp(owner);
    await call("patch", `/users/${person.body.id}`, owner.cookie).send({ branchId: north }).expect(200);
    expect(await storedBranch(person.body.id)).toBe(north);
    const [row] = await withCompanyDb((db) =>
      db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.targetId, person.body.id), eq(auditLog.action, "Updated user"))),
    );
    expect((row?.after as { branchId?: string }).branchId).toBe(north);
  });

  it("IB5 keeps a branch admin's invitations to their own branch", async () => {
    await stepUp(branchAdmin);
    const other = await invite(branchAdmin.cookie, south, "admin-south");
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("branch_other");
    const none = await invite(branchAdmin.cookie, "", "admin-none");
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("branch_other");
    const own = await invite(branchAdmin.cookie, north, "admin-north").expect(201);
    expect(own.body.branchId).toBe(north);
  });

  it("IB6 lets a branch admin move people only from and to their own branch", async () => {
    await stepUp(owner);
    const inSouth = await invite(owner.cookie, south, "in-south").expect(201);
    const inNorth = await invite(owner.cookie, north, "in-north").expect(201);
    await stepUp(branchAdmin);
    const pull = await call("patch", `/users/${inSouth.body.id}`, branchAdmin.cookie).send({ branchId: north });
    expect(pull.status).toBe(403);
    expect(pull.body.code).toBe("branch_other");
    const push = await call("patch", `/users/${inNorth.body.id}`, branchAdmin.cookie).send({ branchId: south });
    expect(push.status).toBe(403);
    const clear = await call("patch", `/users/${inNorth.body.id}`, branchAdmin.cookie).send({ branchId: "" });
    expect(clear.status).toBe(403);
    expect(await storedBranch(inSouth.body.id)).toBe(south);
    expect(await storedBranch(inNorth.body.id)).toBe(north);
    await call("patch", `/users/${inNorth.body.id}`, branchAdmin.cookie).send({ title: "Lead" }).expect(200);
  });

  it("IB8 lets a branch admin change nothing about people in another branch or in none", async () => {
    await stepUp(owner);
    const inSouth = await invite(owner.cookie, south, "other-south").expect(201);
    const nowhere = await invite(owner.cookie, "", "other-none").expect(201);
    await stepUp(branchAdmin);
    for (const id of [inSouth.body.id, nowhere.body.id]) {
      for (const patch of [{ title: "Renamed" }, { status: "disabled" }, { roleIds: [helperRoleId] }]) {
        const refused = await call("patch", `/users/${id}`, branchAdmin.cookie).send(patch);
        expect(refused.status, JSON.stringify(patch)).toBe(403);
        expect(refused.body.code).toBe("branch_other");
      }
    }
    const listed = await call("get", "/users", owner.cookie).expect(200);
    const kept = listed.body.find((row: { id: string }) => row.id === inSouth.body.id);
    expect(kept).toMatchObject({ title: "", status: "invited" });
  });

  it("IB7 lets an all-scope admin move people between any branches and to none", async () => {
    await stepUp(owner);
    const person = await invite(owner.cookie, north, "owner-move").expect(201);
    await stepUp(owner);
    await call("patch", `/users/${person.body.id}`, owner.cookie).send({ branchId: south }).expect(200);
    await stepUp(owner);
    await call("patch", `/users/${person.body.id}`, owner.cookie).send({ branchId: "" }).expect(200);
    expect(await storedBranch(person.body.id)).toBeNull();
  });
});
