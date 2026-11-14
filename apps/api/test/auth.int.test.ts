import { session, tenants, user } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthHarness, isUuidV7, PASSWORD, sessionCookie, SUMMIT_ID } from "./auth-harness";

/** A moment the given number of minutes ago. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("sign-in with Better Auth (P8 part 1, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();

  beforeAll(async () => {
    await harness.start();
  }, 60_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** Moves a user's session timestamps, to stand in for time passing. */
  async function ageSession(email: string, times: { createdAt?: Date; updatedAt?: Date }): Promise<void> {
    const [owner] = await harness.control.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    await harness.control.db.update(session).set(times).where(eq(session.userId, owner.id));
  }

  describe("accounts and passwords", () => {
    it("refuses public sign-up, because accounts are invite-only", async () => {
      const response = await harness
        .post("/api/auth/sign-up/email")
        .send({ email: "new@example.test", password: PASSWORD, name: "New Person" });
      expect(response.status).toBeGreaterThanOrEqual(400);
      const [created] = await harness.control.db.select().from(user).where(eq(user.email, "new@example.test"));
      expect(created).toBeUndefined();
    });

    it("signs a seeded user in with an httpOnly, SameSite=Lax cookie and a UUID v7 session id", async () => {
      const email = await harness.summitEmail();
      const response = await harness.post("/api/auth/sign-in/email").send({ email, password: PASSWORD }).expect(200);
      const cookie = [response.headers["set-cookie"]].flat().find((value) => value?.includes("session_token="));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      const [row] = await harness.control.db
        .select({ id: session.id })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(eq(user.email, email));
      expect(isUuidV7(row.id)).toBe(true);
    });

    it("refuses a wrong password without saying which part was wrong", async () => {
      const email = await harness.summitEmail();
      const response = await harness.post("/api/auth/sign-in/email").send({ email, password: `${PASSWORD}x` });
      expect(response.status).toBe(401);
      expect(response.body.message).toMatch(/invalid email or password/i);
    });

    it("refuses a new password shorter than 12 characters", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      const response = await harness
        .post("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: PASSWORD, newPassword: "too-short" });
      expect(response.status).toBe(400);
    });
  });

  describe("email verification", () => {
    it("refuses an unverified user, emails a link, and lets them in once they follow it", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], verified: false });
      const refused = await harness.post("/api/auth/sign-in/email").send({ email, password: PASSWORD });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("EMAIL_NOT_VERIFIED");

      // The email is sent after the response; wait for it rather than a fixed delay (flaky under load).
      const sent = await vi.waitFor(
        () => {
          const found = harness.outbox.sent.find((message) => message.to.includes(email));
          if (!found) throw new Error("No verification email yet.");
          return found;
        },
        { timeout: 5_000 },
      );
      expect(sent.subject).toBe("Confirm your email address");
      const link = sent?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
      expect(new URL(link).host).toBe("localhost:3000");

      const url = new URL(link);
      await harness.get(`${url.pathname}${url.search}`);
      const [verified] = await harness.control.db.select().from(user).where(eq(user.email, email));
      expect(verified.emailVerified).toBe(true);
      await harness.signIn(email);
    });
  });

  describe("session context and timeouts (blueprint p28)", () => {
    it("answers /auth/context with the user and the open company", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      const response = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(response.body.user.email).toBe(email);
      expect(response.body.company).toMatchObject({ id: SUMMIT_ID, slug: "summit" });
      expect(response.body.companies).toHaveLength(1);
    });

    it("answers 401 with the shared error body when there is no session", async () => {
      const response = await harness.get("/auth/context").expect(401);
      expect(response.body).toMatchObject({ code: "unauthenticated" });
    });

    it("ends a session idle for longer than the company's idle timeout", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { updatedAt: minutesAgo(31) });
      const response = await harness.get("/auth/context").set("Cookie", cookie).expect(401);
      expect(response.body.code).toBe("session_expired");
      await harness.get("/auth/context").set("Cookie", cookie).expect(401);
    });

    it("ends a session older than the absolute timeout even when it is active", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { createdAt: minutesAgo(721), updatedAt: minutesAgo(1) });
      const response = await harness.get("/auth/context").set("Cookie", cookie).expect(401);
      expect(response.body.code).toBe("session_expired");
    });

    it("records activity, so a session in use does not go idle", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { updatedAt: minutesAgo(29) });
      await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      await ageSession(email, { updatedAt: minutesAgo(29) });
      await harness.get("/auth/context").set("Cookie", cookie).expect(200);
    });

    it("uses the company's own timeouts", async () => {
      const strict = await harness.addCompany("strict-co", { idleMin: 5, absoluteMin: 60 });
      const email = await harness.addUser({ companyIds: [strict] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { updatedAt: minutesAgo(6) });
      await harness.get("/auth/context").set("Cookie", cookie).expect(401);
    });

    it("refuses an idle session on Better Auth's own endpoints, so set-active cannot revive it", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { updatedAt: minutesAgo(31) });
      const revive = await harness
        .post("/api/auth/organization/set-active")
        .set("Cookie", cookie)
        .send({ organizationId: SUMMIT_ID })
        .expect(401);
      expect(revive.body.code).toBe("session_expired");
      const after = await harness.get("/api/auth/get-session").set("Cookie", cookie).expect(200);
      expect(after.body).toBeNull();
      await harness.get("/auth/context").set("Cookie", cookie).expect(401);
    });

    it("lets a person with an ended session sign in again", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { updatedAt: minutesAgo(31) });
      await harness
        .post("/api/auth/sign-in/email")
        .set("Cookie", cookie)
        .send({ email, password: PASSWORD })
        .expect(200);
    });

    it("refuses an idle session on get-session too, and deletes it", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await ageSession(email, { updatedAt: minutesAgo(31) });
      const response = await harness.get("/api/auth/get-session").set("Cookie", cookie).expect(401);
      expect(response.body.code).toBe("session_expired");
      const [owner] = await harness.control.db.select({ id: user.id }).from(user).where(eq(user.email, email));
      expect(await harness.control.db.select().from(session).where(eq(session.userId, owner.id))).toHaveLength(0);
    });

    it("signs out, after which the cookie no longer works", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      await harness.post("/api/auth/sign-out").set("Cookie", cookie).send({}).expect(200);
      await harness.get("/auth/context").set("Cookie", cookie).expect(401);
    });
  });

  describe("which company opens", () => {
    it("leaves a user with several companies to choose, then opens the one they pick", async () => {
      const second = await harness.addCompany("second-co");
      const email = await harness.addUser({ companyIds: [SUMMIT_ID, second] });
      const cookie = await harness.signIn(email);
      const before = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(before.body.company).toBeNull();
      expect(before.body.companies).toHaveLength(2);

      await harness
        .post("/api/auth/organization/set-active")
        .set("Cookie", cookie)
        .send({ organizationId: second })
        .expect(200);
      const after = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(after.body.company.id).toBe(second);
    });

    it("refuses to open a company the user is not a member of", async () => {
      const other = await harness.addCompany("other-co");
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      const response = await harness
        .post("/api/auth/organization/set-active")
        .set("Cookie", cookie)
        .send({ organizationId: other });
      expect(response.status).toBeGreaterThanOrEqual(400);
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.company.id).toBe(SUMMIT_ID);
    });

    it("refuses a switch to no company or by slug, and keeps the open company", async () => {
      const second = await harness.addCompany("slug-co");
      const email = await harness.addUser({ companyIds: [SUMMIT_ID, second] });
      const cookie = await harness.signIn(email);
      await harness
        .post("/api/auth/organization/set-active")
        .set("Cookie", cookie)
        .send({ organizationId: SUMMIT_ID })
        .expect(200);
      for (const body of [{ organizationId: null }, { organizationSlug: "slug-co" }, {}]) {
        const response = await harness.post("/api/auth/organization/set-active").set("Cookie", cookie).send(body);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe("company_id_required");
      }
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.company.id).toBe(SUMMIT_ID);
    });

    it("refuses a switch to another company on a host that names a company", async () => {
      const second = await harness.addCompany("bound-co");
      const both = await harness.addUser({ companyIds: [SUMMIT_ID, second] });
      const host = "bound-co.flooringsuite.test";
      const cookie = await harness.signIn(both, host);
      const response = await harness
        .post("/api/auth/organization/set-active", host)
        .set("Cookie", cookie)
        .send({ organizationId: SUMMIT_ID });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("wrong_host");
      const context = await harness.get("/auth/context", host).set("Cookie", cookie).expect(200);
      expect(context.body.company.id).toBe(second);
    });

    it("leaves deleted companies out of sign-in", async () => {
      const deleted = await harness.addCompany("deleted-co");
      await harness.control.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, deleted));
      const email = await harness.addUser({ companyIds: [SUMMIT_ID, deleted] });
      const cookie = await harness.signIn(email);
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.company.id).toBe(SUMMIT_ID);
      expect(context.body.companies).toHaveLength(1);
    });

    it("opens the company the host names, and refuses a user who is not its member", async () => {
      const second = await harness.addCompany("hosted-co");
      const both = await harness.addUser({ companyIds: [SUMMIT_ID, second] });
      const cookie = await harness.signIn(both, "hosted-co.flooringsuite.test");
      const context = await harness.get("/auth/context", "hosted-co.flooringsuite.test").set("Cookie", cookie);
      expect(context.body.company.id).toBe(second);

      const outsider = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const refused = await harness
        .post("/api/auth/sign-in/email", "hosted-co.flooringsuite.test")
        .send({ email: outsider, password: PASSWORD });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("not_a_member");
    });

    it("refuses a user who belongs to no company", async () => {
      const email = await harness.addUser({ companyIds: [] });
      const response = await harness.post("/api/auth/sign-in/email").send({ email, password: PASSWORD });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("no_company");
    });

    it("keeps the organization plugin's membership endpoints closed", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const cookie = await harness.signIn(email);
      const response = await harness
        .post("/api/auth/organization/invite-member")
        .set("Cookie", cookie)
        .send({ email: "someone@example.test", role: "member", organizationId: SUMMIT_ID });
      expect(response.status).toBe(404);
    });
  });

  it("the cookie helper finds the session cookie", () => {
    expect(sessionCookie(["a=1; Path=/", "better-auth.session_token=abc.def; HttpOnly"])).toBe(
      "better-auth.session_token=abc.def",
    );
  });
});
