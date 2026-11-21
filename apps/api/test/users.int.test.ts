import { auditLog, rolePermissions, roles as roleTable } from "@workspace/db/company";
import {
  member,
  planLimits,
  plans,
  platformAdmins,
  products,
  tenantSubscriptions,
  twoFactor,
  user,
} from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import type { FeatureKey } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";
import { withFeaturesOff } from "./support/switches";

/** A TOTP code for the next 30-second step, so a code is never used twice in one step. */
function freshCode(secret: string): string {
  return totpCode(secret, new Date(Date.now() + 30_000));
}

/**
 * Settings → Users and Roles, step-up, invitations, password reset and support access (P10 part 2;
 * draft spec docs/specs/settings-users-access.md), against a provisioned company database.
 */
describe("users, roles and access requests (P10 part 2, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let owner = { email: "", cookie: "", secret: "" };

  /** A request to a company route as the web proxy sends it. */
  function call(method: "get" | "post" | "patch" | "put" | "delete", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  /** Signs in a user whose roles need MFA, enrols an authenticator app, and returns the session. */
  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    expect(confirmed.status).toBe(200);
    return { email, cookie: sessionCookie(confirmed.headers["set-cookie"]), secret };
  }

  async function stepUp(who: { cookie: string; secret: string }) {
    await harness
      .post("/auth/step-up")
      .set("Cookie", who.cookie)
      .send({ code: freshCode(who.secret) })
      .expect(204);
  }

  async function roleId(key: string): Promise<string> {
    const handle = await harness.companyDb(company.id);
    try {
      const [row] = await handle.db.select({ id: roleTable.id }).from(roleTable).where(eq(roleTable.key, key));
      return row.id;
    } finally {
      await handle.close();
    }
  }

  async function memberRole(email: string): Promise<string> {
    const [row] = await harness.control.db
      .select({ role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(user.email, email), eq(member.organizationId, company.id)));
    return row.role;
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("users");
    owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("lists users and roles for those who may see them, and refuses others", async () => {
    const users = await call("get", "/users", owner.cookie).expect(200);
    expect(users.body.map((row: { email: string }) => row.email)).toContain(owner.email);
    const roles = await call("get", "/roles", owner.cookie).expect(200);
    expect(roles.body.map((row: { key: string }) => row.key)).toContain("owner");
    const sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    expect((await call("get", "/users", sales)).status).toBe(403);
    expect((await call("get", "/audit", sales)).status).toBe(403);
  });

  it("hides each Users, Roles, Audit log and Support access route with its switch off (rule 13, F-h)", async () => {
    const NIL = "00000000-0000-0000-0000-000000000000";
    type Route = readonly ["get" | "post" | "patch" | "put" | "delete", string];
    const hidden: readonly (readonly [FeatureKey, readonly Route[]])[] = [
      [
        "settings.users",
        [
          ["post", "/users/invite"],
          ["patch", `/users/${NIL}`],
          ["get", "/support-grants"],
          ["post", `/support-grants/${NIL}/approve`],
          ["post", `/support-grants/${NIL}/revoke`],
        ],
      ],
      [
        "settings.roles",
        [
          ["post", "/roles"],
          ["put", `/roles/${NIL}`],
          ["post", `/roles/${NIL}/reset`],
          ["delete", `/roles/${NIL}`],
        ],
      ],
      ["settings.audit", [["get", "/audit"]]],
    ];
    /** The bare 404 a switched-off feature answers; a missing record's 404 has words. */
    const switchedOff = (answer: request.Response) =>
      answer.status === 404 && answer.body.code === "not_found" && answer.body.message === "Not Found";
    for (const [key, routes] of hidden) {
      for (const [method, path] of routes) {
        // With the switch on the route answers something else, so the 404 with it off is the switch's own.
        const on = await call(method, path, owner.cookie).send({});
        const off = await withFeaturesOff([key], () => call(method, path, owner.cookie).send({}));
        expect({ key, method, path, on: switchedOff(on), off: switchedOff(off) }).toEqual({
          key,
          method,
          path,
          on: false,
          off: true,
        });
      }
    }
  });

  it("answers GET /users and GET /roles while either the Users or the Roles page is on (each page reads both)", async () => {
    for (const key of ["settings.users", "settings.roles"] as const) {
      await withFeaturesOff([key], async () => {
        await call("get", "/users", owner.cookie).expect(200);
        await call("get", "/roles", owner.cookie).expect(200);
      });
    }
    await withFeaturesOff(["settings.users", "settings.roles"], async () => {
      for (const path of ["/users", "/roles"]) {
        const answer = await call("get", path, owner.cookie);
        expect([path, answer.status, answer.body.code, answer.body.message]).toEqual([
          path,
          404,
          "not_found",
          "Not Found",
        ]);
      }
    });
  });

  it("needs a step-up to change roles, checks the code, and syncs member.role with the mfa marker", async () => {
    const email = await harness.addUser({ companyIds: [company.id], roles: ["sales"] });
    const id = await harness.userIdOf(email);
    const accountant = await roleId("accountant");
    const refused = await call("patch", `/users/${id}`, owner.cookie).send({ roleIds: [accountant] });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("step_up_required");
    const wrong = await harness.post("/auth/step-up").set("Cookie", owner.cookie).send({ code: "000000" });
    expect(wrong.body.code).toBe("step_up_invalid");
    await stepUp(owner);
    const changed = await call("patch", `/users/${id}`, owner.cookie)
      .send({ roleIds: [accountant] })
      .expect(200);
    expect(changed.body.roleIds).toEqual([accountant]);
    expect((await memberRole(email)).split(",")).toEqual(["accountant", "mfa"]);
  });

  it("refuses a role the actor could not hold, and Owner from a non-Owner (no escalation)", async () => {
    await stepUp(owner);
    const created = await call("post", "/roles", owner.cookie)
      .send({
        name: "User admin",
        description: "",
        dataScope: "all",
        permissions: ["settings.users.view", "settings.users.manage"],
      })
      .expect(201);
    const admin = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    await stepUp(owner);
    await call("patch", `/users/${await harness.userIdOf(admin.email)}`, owner.cookie)
      .send({ roleIds: [created.body.id] })
      .expect(200);
    const target = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: [] }));
    await stepUp(admin);
    const notHeld = await call("patch", `/users/${target}`, admin.cookie).send({
      roleIds: [await roleId("accountant")],
    });
    expect(notHeld.body.code).toBe("not_held");
    const ownerOnly = await call("patch", `/users/${target}`, admin.cookie).send({ roleIds: [await roleId("owner")] });
    expect(ownerOnly.body.code).toBe("owner_only");
  });

  it("keeps an active Owner and protects the Owner role, default roles and held roles", async () => {
    const ownerId = await harness.userIdOf(owner.email);
    await stepUp(owner);
    const lastOwner = await call("patch", `/users/${ownerId}`, owner.cookie).send({ roleIds: [await roleId("sales")] });
    expect(lastOwner.body.code).toBe("last_owner");
    expect((await call("patch", `/users/${ownerId}`, owner.cookie).send({ status: "disabled" })).body.code).toBe(
      "last_owner",
    );
    const locked = await call("put", `/roles/${await roleId("owner")}`, owner.cookie).send({
      name: "Owner",
      description: "",
      dataScope: "all",
      permissions: [],
    });
    expect(locked.body.code).toBe("owner_locked");
    expect((await call("delete", `/roles/${await roleId("sales")}`, owner.cookie)).body.code).toBe("system_role");
    const spare = await call("post", "/roles", owner.cookie)
      .send({ name: "Spare", description: "", dataScope: "own", permissions: [] })
      .expect(201);
    await call("delete", `/roles/${spare.body.id}`, owner.cookie).expect(204);
  });

  it("refuses a role save that adds keys the editor does not hold", async () => {
    await stepUp(owner);
    const roleAdmin = await call("post", "/roles", owner.cookie)
      .send({
        name: "Role admin",
        description: "",
        dataScope: "all",
        permissions: ["settings.roles.view", "settings.roles.manage"],
      })
      .expect(201);
    const editor = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    await stepUp(owner);
    await call("patch", `/users/${await harness.userIdOf(editor.email)}`, owner.cookie)
      .send({ roleIds: [roleAdmin.body.id] })
      .expect(200);
    await stepUp(editor);
    const escalated = await call("post", "/roles", editor.cookie).send({
      name: "Sneaky",
      description: "",
      dataScope: "all",
      permissions: ["sales.payment.approve"],
    });
    expect(escalated.status).toBe(403);
    expect(escalated.body.code).toBe("not_held");
  });

  it("invites a person who sets a password once, then signs in; the link cannot be used again", async () => {
    const email = `invitee-${Date.now()}@example.test`;
    const unconfirmed = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    const refused = await call("post", "/users/invite", unconfirmed.cookie).send({
      name: "No Step",
      email: `nostep-${Date.now()}@example.test`,
      title: "",
      roleIds: [await roleId("sales")],
      branchId: "",
    });
    expect(refused.body.code).toBe("step_up_required");
    await stepUp(owner);
    const invited = await call("post", "/users/invite", owner.cookie)
      .send({ name: "Ivy Invitee", email, title: "Sales", roleIds: [await roleId("sales")], branchId: "" })
      .expect(201);
    expect(invited.body.status).toBe("invited");
    const message = harness.outbox.sent.find((sent) => sent.to.includes(email));
    const token =
      new URL(/https?:\/\/\S+/.exec(message?.text ?? "")?.[0] ?? "http://x").searchParams.get("token") ?? "";
    expect(token).not.toBe("");
    const looked = await harness.get(`/public/invitations/${token}`).expect(200);
    expect(looked.body).toMatchObject({ email, needsPassword: true });
    expect((await harness.post("/public/invitations/accept").send({ token, password: "short" })).status).toBe(400);
    await harness.post("/public/invitations/accept").send({ token, password: PASSWORD }).expect(204);
    expect((await harness.post("/public/invitations/accept").send({ token, password: PASSWORD })).status).toBe(410);
    const cookie = await harness.signIn(email);
    expect((await call("get", "/roles", cookie)).status).toBe(403);
    const listed = await call("get", "/users", owner.cookie).expect(200);
    expect(listed.body.find((row: { email: string }) => row.email === email).status).toBe("active");
  });

  it("refuses an invitation past the plan's seat limit", async () => {
    const [flooring] = await harness.control.db.select().from(products).where(eq(products.key, "flooring"));
    const [plan] = await harness.control.db
      .insert(plans)
      .values({
        key: `seats-${company.slug}`,
        name: "Seats",
        productId: flooring.id,
        monthlyPrice: "10",
        yearlyPrice: "100",
      })
      .returning();
    await harness.control.db.insert(planLimits).values({ planId: plan.id, maxUsers: 1, maxBranches: 1 });
    const [subscription] = await harness.control.db
      .insert(tenantSubscriptions)
      .values({
        tenantId: company.id,
        planId: plan.id,
        interval: "monthly",
        price: "10",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        status: "active",
      })
      .returning();
    try {
      await stepUp(owner);
      const refused = await call("post", "/users/invite", owner.cookie).send({
        name: "No Seat",
        email: `noseat-${Date.now()}@example.test`,
        title: "",
        roleIds: [await roleId("sales")],
        branchId: "",
      });
      expect(refused.body.code).toBe("seat_limit");
    } finally {
      await harness.control.db.delete(tenantSubscriptions).where(eq(tenantSubscriptions.id, subscription.id));
    }
  });

  it("resets MFA for a person of this company only, never for a shared account", async () => {
    const other = await harness.provisionCompany("usersother");
    const shared = await harness.addUser({ companyIds: [company.id, other.id], roles: ["sales"] });
    await stepUp(owner);
    const refused = await call("patch", `/users/${await harness.userIdOf(shared)}`, owner.cookie).send({
      mfaEnrolled: false,
    });
    expect(refused.body.code).toBe("shared_account");
    const single = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }));
    const singleId = await harness.userIdOf(single.email);
    await stepUp(owner);
    await call("patch", `/users/${singleId}`, owner.cookie).send({ mfaEnrolled: false }).expect(200);
    expect(await harness.control.db.select().from(twoFactor).where(eq(twoFactor.userId, singleId))).toHaveLength(0);
  });

  it("sends at most 3 reset emails an hour per address and resets the password with the link", async () => {
    const email = await harness.addUser({ companyIds: [company.id], roles: ["sales"] });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await harness
        .post("/api/auth/request-password-reset")
        .send({ email, redirectTo: "http://localhost:3000/reset-password" })
        .expect(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const resets = harness.outbox.sent.filter(
      (sent) => sent.to.includes(email) && sent.subject === "Reset your password",
    );
    expect(resets).toHaveLength(3);
    const link = /https?:\/\/\S+/.exec(resets[0].text)?.[0] ?? "";
    const token = new URL(link).pathname.split("/").pop() ?? "";
    await harness.post("/api/auth/reset-password").send({ token, newPassword: "a-brand-new-password" }).expect(200);
    const signedIn = await harness.post("/api/auth/sign-in/email").send({ email, password: "a-brand-new-password" });
    expect(signedIn.status).toBe(200);
  });

  it("lets a platform admin ask for support access and only the Owner approve it, with a step-up", async () => {
    // Platform admins sign in through a company until the admin host exists (an owner question, ADR 0052).
    const home = await harness.provisionCompany("supporthome");
    const adminEmail = await harness.addUser({ companyIds: [home.id], roles: ["sales"] });
    await harness.control.db
      .insert(platformAdmins)
      .values({ userId: await harness.userIdOf(adminEmail), role: "support", active: true });
    const admin = await enrolled(adminEmail);
    // Every /platform write needs a step-up, the support request included (ADR 0052).
    await stepUp(admin);
    const requested = await harness
      .post("/platform/support-grants")
      .set("Cookie", admin.cookie)
      .send({ companyId: company.id, reason: "Customer asked for help with roles", hours: 4 })
      .expect(201);
    const notAdmin = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    expect(
      (
        await harness
          .post("/platform/support-grants")
          .set("Cookie", notAdmin)
          .send({ companyId: company.id, reason: "Not allowed to ask", hours: 4 })
      ).status,
    ).toBe(403);
    expect((await call("get", "/support-grants", notAdmin)).status).toBe(403);
    const listed = await call("get", "/support-grants", owner.cookie).expect(200);
    expect(listed.body[0]).toMatchObject({ id: requested.body.id, status: "pending" });
    const approved = await call("post", `/support-grants/${requested.body.id}/approve`, owner.cookie);
    if (approved.status !== 204) {
      expect(approved.body.code).toBe("step_up_required");
      await stepUp(owner);
      await call("post", `/support-grants/${requested.body.id}/approve`, owner.cookie).expect(204);
    }
    await call("post", `/support-grants/${requested.body.id}/revoke`, owner.cookie).expect(204);
    expect((await call("get", "/support-grants", owner.cookie)).body[0].status).toBe("revoked");
  });

  it("resets a changed default role to its shipped keys, audited; never the Owner role or a custom one (F-q)", async () => {
    await stepUp(owner);
    const salesId = await roleId("sales");
    const shipped = async () =>
      ((await call("get", "/roles", owner.cookie).expect(200)).body as { id: string; permissions: string[] }[])
        .find((role) => role.id === salesId)!
        .permissions.slice()
        .sort();
    const before = await shipped();
    const removed = before[0]!;
    const handle = await harness.companyDb(company.id);
    let custom = "";
    let audited = 0;
    try {
      await handle.db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, salesId), eq(rolePermissions.permissionKey, removed)));
      const [row] = await handle.db
        .insert(roleTable)
        .values({ key: "reset-custom", name: "Reset custom", dataScope: "own" as const })
        .returning({ id: roleTable.id });
      custom = row.id;
      const [admin] = await handle.db
        .insert(roleTable)
        .values({ key: "reset-admin", name: "Reset admin", dataScope: "all" as const })
        .returning({ id: roleTable.id });
      await handle.db.insert(rolePermissions).values(
        (["settings.roles.view", "settings.roles.manage"] as const).map((permissionKey) => ({
          roleId: admin.id,
          permissionKey,
        })),
      );
      audited = (await handle.db.select().from(auditLog).where(eq(auditLog.targetId, salesId))).length;
    } finally {
      await handle.close();
    }
    expect(await shipped()).not.toContain(removed);
    // A role admin who doesn't hold Sales's keys: first the step-up, then no escalation (rule 4).
    const roleAdmin = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["reset-admin"] }));
    const noStepUp = await call("post", `/roles/${salesId}/reset`, roleAdmin.cookie);
    expect([noStepUp.status, noStepUp.body.code]).toEqual([403, "step_up_required"]);
    await stepUp(roleAdmin);
    const escalation = await call("post", `/roles/${salesId}/reset`, roleAdmin.cookie);
    expect(escalation.status).toBe(403);
    expect(escalation.body.code).toMatch(/^role_/);
    expect(await shipped()).not.toContain(removed);
    await stepUp(owner);
    const reset = await call("post", `/roles/${salesId}/reset`, owner.cookie).expect(201);
    expect([...(reset.body.permissions as string[])].sort()).toEqual(before);
    expect(await shipped()).toEqual(before);
    const after = await harness.companyDb(company.id);
    try {
      const rows = await after.db.select().from(auditLog).where(eq(auditLog.targetId, salesId));
      expect(rows).toHaveLength(audited + 1);
      const ownerId = await harness.userIdOf(owner.email);
      expect(rows.filter((row) => row.action === "Changed role" && row.actorUserId === ownerId)).toHaveLength(1);
    } finally {
      await after.close();
    }
    const ownerRole = await call("post", `/roles/${await roleId("owner")}/reset`, owner.cookie);
    expect([ownerRole.status, ownerRole.body.code]).toEqual([403, "owner_locked"]);
    const notDefault = await call("post", `/roles/${custom}/reset`, owner.cookie);
    expect([notDefault.status, notDefault.body.code]).toEqual([409, "not_default"]);
    const sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    const refused = await call("post", `/roles/${salesId}/reset`, sales);
    expect([refused.status, refused.body.code]).toEqual([403, "forbidden"]);
  });

  it("records the changes in the audit log the Owner can read", async () => {
    const entries = await call("get", "/audit", owner.cookie).expect(200);
    const actions = entries.body.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["Changed roles", "Created role", "Invited user", "Reset MFA"]));
    // The role ids an invitation names come with the roles' names, so the screen shows names (#58).
    type Entry = { action: string; after: string | null; names?: Record<string, string> };
    const roleIdsOf = (entry: Entry) => (JSON.parse(entry.after ?? "{}") as { roleIds?: string[] }).roleIds ?? [];
    const invited = (entries.body as Entry[]).find((e) => e.action === "Invited user" && roleIdsOf(e).length > 0);
    expect(invited).toBeDefined();
    for (const id of roleIdsOf(invited!)) expect(invited!.names?.[id]).toEqual(expect.any(String));
    const handle = await harness.companyDb(company.id);
    try {
      const rows = await handle.db.select().from(auditLog).where(eq(auditLog.action, "Approved support access"));
      expect(rows).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("never lets someone change a person who holds more than they do (PR #11 security review)", async () => {
    await stepUp(owner);
    const created = await call("post", "/roles", owner.cookie)
      .send({
        name: "People admin",
        description: "",
        dataScope: "all",
        permissions: ["settings.users.view", "settings.users.manage"],
      })
      .expect(201);
    const admin = await enrolled(await harness.addUser({ companyIds: [company.id], roles: [] }));
    await stepUp(owner);
    await call("patch", `/users/${await harness.userIdOf(admin.email)}`, owner.cookie)
      .send({ roleIds: [created.body.id] })
      .expect(200);
    await stepUp(admin);
    const ownerId = await harness.userIdOf(owner.email);
    for (const patch of [{ mfaEnrolled: false }, { status: "disabled" }, { roleIds: [created.body.id] }]) {
      const refused = await call("patch", `/users/${ownerId}`, admin.cookie).send(patch);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("holder_owner_only");
    }
    const accountant = await harness.userIdOf(
      await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
    );
    expect((await call("patch", `/users/${accountant}`, admin.cookie).send({ status: "disabled" })).body.code).toBe(
      "holder_not_held",
    );
  });

  it("needs a step-up to disable someone, and refuses an MFA reset for a platform admin", async () => {
    const fresh = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    const target = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    expect((await call("patch", `/users/${target}`, fresh.cookie).send({ status: "disabled" })).body.code).toBe(
      "step_up_required",
    );
    await harness.control.db.insert(platformAdmins).values({ userId: target, role: "support", active: true });
    await stepUp(fresh);
    expect((await call("patch", `/users/${target}`, fresh.cookie).send({ mfaEnrolled: false })).body.code).toBe(
      "shared_account",
    );
  });

  it("checks at most 5 step-up codes, however many arrive at once (PR #11 security review)", async () => {
    const racer = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    const answers = await Promise.all(
      Array.from({ length: 12 }, () =>
        harness.post("/auth/step-up").set("Cookie", racer.cookie).send({ code: "000000" }),
      ),
    );
    expect(answers.filter((answer) => answer.body.code === "step_up_invalid").length).toBeLessThanOrEqual(5);
    expect(answers.filter((answer) => answer.status === 429).length).toBeGreaterThanOrEqual(7);
    const locked = await harness
      .post("/auth/step-up")
      .set("Cookie", racer.cookie)
      .send({ code: freshCode(racer.secret) });
    expect(locked.status).toBe(429);
  });

  it("refuses a role with a wider data scope than the editor's own", async () => {
    await stepUp(owner);
    const branchAdmin = await call("post", "/roles", owner.cookie)
      .send({
        name: "Branch roles",
        description: "",
        dataScope: "branch",
        permissions: ["settings.roles.view", "settings.roles.manage"],
      })
      .expect(201);
    const editor = await enrolled(await harness.addUser({ companyIds: [company.id], roles: [] }));
    await stepUp(owner);
    await call("patch", `/users/${await harness.userIdOf(editor.email)}`, owner.cookie)
      .send({ roleIds: [branchAdmin.body.id] })
      .expect(200);
    await stepUp(editor);
    const wider = await call("put", `/roles/${branchAdmin.body.id}`, editor.cookie).send({
      name: "Branch roles",
      description: "",
      dataScope: "all",
      permissions: ["settings.roles.view", "settings.roles.manage"],
    });
    expect(wider.body.code).toBe("scope_wider");
  });

  it("asks for MFA when a held role needs it, even if member.role missed the change (backstop)", async () => {
    const email = await harness.addUser({ companyIds: [company.id], roles: ["warehouse"] });
    const cookie = await harness.signIn(email);
    await call("get", "/notifications", cookie).expect(200);
    const handle = await harness.companyDb(company.id);
    try {
      await handle.db
        .insert(rolePermissions)
        .values({ roleId: await roleId("warehouse"), permissionKey: "hr.payroll.view" });
      const refused = await call("get", "/notifications", cookie);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("mfa_enrolment_required");
    } finally {
      await handle.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, await roleId("warehouse")),
            eq(rolePermissions.permissionKey, "hr.payroll.view"),
          ),
        );
      await handle.close();
    }
  });

  it("checks second-factor codes with a session only through step-up once the app is on (PR #11 review)", async () => {
    const guessed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", owner.cookie)
      .send({ code: "000000" });
    expect(guessed.status).toBe(404);
    const backup = await harness
      .post("/api/auth/two-factor/verify-backup-code")
      .set("Cookie", owner.cookie)
      .send({ code: "aaaaa-bbbbb" });
    expect(backup.status).toBe(404);
    await stepUp(owner);
  });
});
