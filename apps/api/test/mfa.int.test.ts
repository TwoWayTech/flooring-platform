import { passkey, session, user } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionService } from "../src/core/auth/session.service";
import { AuthHarness, PASSWORD, sessionCookie, SUMMIT_ID } from "./auth-harness";

/** Every cookie a response set, as one Cookie header (session or two-factor challenge). */
function cookiesFrom(setCookie: string[] | string | undefined): string {
  return [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

/** A TOTP code for the 30-second step after `at`, so it never repeats the code just used. */
function nextStepCode(secret: string, at = new Date()): string {
  return totpCode(secret, new Date(at.getTime() + 30_000));
}

describe("MFA: TOTP, backup codes, passkeys and mandatory enrolment (P8 part 2, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();

  beforeAll(async () => {
    await harness.start();
  }, 60_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** Signs a required user in, enrols an authenticator app, and returns its secret and backup codes. */
  async function enrol(email: string): Promise<{ secret: string; backupCodes: string[]; cookie: string }> {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    expect(enabled.status).toBe(200);
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    expect(confirmed.status).toBe(200);
    return {
      secret,
      backupCodes: enabled.body.backupCodes as string[],
      cookie: sessionCookie(confirmed.headers["set-cookie"]),
    };
  }

  /** Starts a password sign-in for a user with an authenticator app; returns the challenge cookie. */
  async function startChallenge(email: string): Promise<string> {
    const response = await harness.post("/api/auth/sign-in/email").send({ email, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.twoFactorRedirect).toBe(true);
    const cookie = cookiesFrom(response.headers["set-cookie"]);
    expect(cookie).toContain("two_factor");
    expect(cookie).not.toContain("session_token");
    return cookie;
  }

  describe("who must use MFA", () => {
    it("lets a user whose roles do not require MFA straight in", async () => {
      const cookie = await harness.signIn(await harness.summitEmail());
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.mfa).toEqual({ required: false, totp: false, passkeys: 0, state: "ok" });
    });

    it.each([["owner"], ["accountant"], ["hr"]])("requires MFA of the %s role", async (role) => {
      const cookie = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: [role] }));
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.mfa.required).toBe(true);
      expect(context.body.mfa.state).toBe("enrolment_required");
    });

    it("requires MFA of seeded Summit users whose roles need it", async () => {
      const cookie = await harness.signIn(await harness.summitEmail({ mfaRequired: true }));
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.mfa.state).toBe("enrolment_required");
    });
  });

  describe("a session that must enrol first", () => {
    it("may only enrol: other Better Auth endpoints and guarded routes answer 403", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const cookie = await harness.signIn(email);
      const refused = await harness
        .post("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: PASSWORD, newPassword: `${PASSWORD}-new` });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("mfa_enrolment_required");
      await expect(
        harness.app.get(SessionService).verify(fromNodeHeaders({ cookie, host: "localhost:3000" })),
      ).rejects.toMatchObject({ response: { code: "mfa_enrolment_required" } });
      const listed = await harness.get("/api/auth/organization/list").set("Cookie", cookie);
      expect(listed.status).toBe(200);
    });

    it("enrols an authenticator app with the password, then the session is full and keeps its company", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["accountant"] });
      const { cookie, backupCodes } = await enrol(email);
      expect(backupCodes).toHaveLength(10);
      const context = await harness.get("/auth/context").set("Cookie", cookie).expect(200);
      expect(context.body.mfa).toMatchObject({ required: true, totp: true, state: "ok" });
      expect(context.body.company?.id).toBe(SUMMIT_ID);
    });

    it("keeps the session's start time when the app is confirmed, so the absolute timeout does not restart", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const [person] = await harness.control.db.select({ id: user.id }).from(user).where(eq(user.email, email));
      const first = await harness.signIn(email);
      const started = new Date(Date.now() - 60 * 60_000);
      await harness.control.db.update(session).set({ createdAt: started }).where(eq(session.userId, person.id));
      const enabled = await harness
        .post("/api/auth/two-factor/enable")
        .set("Cookie", first)
        .send({ password: PASSWORD });
      await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", first)
        .send({ code: totpCode(totpSecretFromUri(enabled.body.totpURI as string)) })
        .expect(200);
      const rows = await harness.control.db
        .select({ createdAt: session.createdAt })
        .from(session)
        .where(eq(session.userId, person.id));
      expect(rows).toHaveLength(1);
      expect(Math.abs(rows[0].createdAt.getTime() - started.getTime())).toBeLessThan(1000);
    });

    it("keeps the session's start time when a password change replaces the session", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const [person] = await harness.control.db.select({ id: user.id }).from(user).where(eq(user.email, email));
      const cookie = await harness.signIn(email);
      const started = new Date(Date.now() - 5 * 60_000);
      await harness.control.db.update(session).set({ createdAt: started }).where(eq(session.userId, person.id));
      const changed = await harness
        .post("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: PASSWORD, newPassword: `${PASSWORD}-new`, revokeOtherSessions: true });
      expect(changed.status).toBe(200);
      const rows = await harness.control.db
        .select({ createdAt: session.createdAt })
        .from(session)
        .where(eq(session.userId, person.id));
      expect(rows).toHaveLength(1);
      expect(Math.abs(rows[0].createdAt.getTime() - started.getTime())).toBeLessThan(1000);
    });

    it("keeps the company a person with several companies chose before enrolling", async () => {
      const other = await harness.addCompany(`mfa-${uuidv7().slice(-8)}`);
      const email = await harness.addUser({ companyIds: [SUMMIT_ID, other], roles: ["hr"] });
      const first = await harness.signIn(email);
      await harness
        .post("/api/auth/organization/set-active")
        .set("Cookie", first)
        .send({ organizationId: other })
        .expect(200);
      const enabled = await harness
        .post("/api/auth/two-factor/enable")
        .set("Cookie", first)
        .send({ password: PASSWORD });
      const secret = totpSecretFromUri(enabled.body.totpURI as string);
      const confirmed = await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", first)
        .send({ code: totpCode(secret) })
        .expect(200);
      const context = await harness
        .get("/auth/context")
        .set("Cookie", sessionCookie(confirmed.headers["set-cookie"]))
        .expect(200);
      expect(context.body.company?.id).toBe(other);
    });

    it("refuses to enrol without the password", async () => {
      const cookie = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] }));
      const response = await harness.post("/api/auth/two-factor/enable").set("Cookie", cookie).send({});
      expect(response.status).toBe(400);
    });
  });

  describe("signing in with a second factor", () => {
    it("asks for a code after the password, refuses a wrong one, and opens a session with the right one", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const { secret } = await enrol(email);
      const challenge = await startChallenge(email);
      const wrong = await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", challenge)
        .send({ code: "000000" });
      expect(wrong.status).toBe(401);
      const right = await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", challenge)
        .send({ code: nextStepCode(secret) });
      // A code for the next 30-second step is accepted within the allowed clock drift.
      expect(right.status).toBe(200);
      const context = await harness
        .get("/auth/context")
        .set("Cookie", sessionCookie(right.headers["set-cookie"]))
        .expect(200);
      expect(context.body.mfa.state).toBe("ok");
    });

    it("accepts each backup code once", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const { backupCodes } = await enrol(email);
      const first = await harness
        .post("/api/auth/two-factor/verify-backup-code")
        .set("Cookie", await startChallenge(email))
        .send({ code: backupCodes[0] });
      expect(first.status).toBe(200);
      const again = await harness
        .post("/api/auth/two-factor/verify-backup-code")
        .set("Cookie", await startChallenge(email))
        .send({ code: backupCodes[0] });
      expect(again.status).toBe(401);
    });

    it("locks the second factor after 5 wrong codes, even with the right one next", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const { secret } = await enrol(email);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await harness
          .post("/api/auth/two-factor/verify-totp")
          .set("Cookie", await startChallenge(email))
          .send({ code: "000000" });
      }
      const locked = await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", await startChallenge(email))
        .send({ code: nextStepCode(secret) });
      expect(locked.status).toBe(429);
    });

    it("never remembers a device", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const { secret } = await enrol(email);
      const response = await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", await startChallenge(email))
        .send({ code: nextStepCode(secret), trustDevice: true });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("trust_device_unsupported");
    });

    it("does not offer codes by email or SMS", async () => {
      const response = await harness.post("/api/auth/two-factor/send-otp").send({});
      expect(response.status).toBe(404);
    });
  });

  describe("no downgrades and passkeys", () => {
    it("refuses to turn the authenticator app off for someone who must use MFA", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const { cookie } = await enrol(email);
      const response = await harness
        .post("/api/auth/two-factor/disable")
        .set("Cookie", cookie)
        .send({ password: PASSWORD });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("mfa_required");
      const [row] = await harness.control.db
        .select({ on: user.twoFactorEnabled })
        .from(user)
        .where(eq(user.email, email));
      expect(row.on).toBe(true);
    });

    it("lets a user who need not use MFA turn the app off", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      const first = await harness.signIn(email);
      const enabled = await harness
        .post("/api/auth/two-factor/enable")
        .set("Cookie", first)
        .send({ password: PASSWORD });
      const secret = totpSecretFromUri(enabled.body.totpURI as string);
      const confirmed = await harness
        .post("/api/auth/two-factor/verify-totp")
        .set("Cookie", first)
        .send({ code: totpCode(secret) })
        .expect(200);
      const response = await harness
        .post("/api/auth/two-factor/disable")
        .set("Cookie", sessionCookie(confirmed.headers["set-cookie"]))
        .send({ password: PASSWORD });
      expect(response.status).toBe(200);
    });

    it("refuses a password-only sign-in by a required user whose factor is a passkey", async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
      const [person] = await harness.control.db.select({ id: user.id }).from(user).where(eq(user.email, email));
      await harness.control.db.insert(passkey).values({
        id: uuidv7(),
        name: "Laptop",
        publicKey: "test-public-key",
        userId: person.id,
        credentialID: `cred-${uuidv7()}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: new Date(),
      });
      const response = await harness.post("/api/auth/sign-in/email").send({ email, password: PASSWORD });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("passkey_required");
      expect(cookiesFrom(response.headers["set-cookie"])).not.toMatch(/session_token=[^;]/);
      const sessions = await harness.control.db.select().from(session).where(eq(session.userId, person.id));
      expect(sessions).toHaveLength(0);
    });

    it("asks for the password before a passkey can be added, on the same session", async () => {
      const cookie = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID] }));
      const refused = await harness.get("/api/auth/passkey/generate-register-options").set("Cookie", cookie);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("password_confirmation_required");
      const wrong = await harness
        .post("/api/auth/verify-password")
        .set("Cookie", cookie)
        .send({ password: `${PASSWORD}x` });
      expect(wrong.status).not.toBe(200);
      expect((await harness.get("/api/auth/passkey/generate-register-options").set("Cookie", cookie)).status).toBe(403);
      await harness.post("/api/auth/verify-password").set("Cookie", cookie).send({ password: PASSWORD }).expect(200);
      const allowed = await harness.get("/api/auth/passkey/generate-register-options").set("Cookie", cookie);
      expect(allowed.status).toBe(200);
      expect(allowed.body.rp.id).toBe("localhost");
      const otherSession = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID] }));
      expect(
        (await harness.get("/api/auth/passkey/generate-register-options").set("Cookie", otherSession)).status,
      ).toBe(403);
    });

    it("refuses a passkey registration that would start a new session", async () => {
      const cookie = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID] }));
      const response = await harness
        .post("/api/auth/passkey/verify-registration")
        .set("Cookie", cookie)
        .send({ response: {}, createSession: true });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("create_session_unsupported");
    });

    it("offers passkey sign-in options without a session", async () => {
      const response = await harness.get("/api/auth/passkey/generate-authenticate-options");
      expect(response.status).toBe(200);
      expect(response.body.rpId).toBe("localhost");
    });
  });
});
