import { authAttempts } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, SUMMIT_ID, WEB_ORIGIN } from "./auth-harness";

describe("password lockout and rate limits (P8 part 2, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();

  beforeAll(async () => {
    await harness.start();
  }, 60_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** One sign-in attempt; a wrong password unless `right` is set. */
  function attempt(email: string, right = false, ip?: string) {
    return harness
      .post("/api/auth/sign-in/email", undefined, ip)
      .send({ email, password: right ? PASSWORD : `${PASSWORD}-wrong` });
  }

  /** Moves an address's recorded attempts back in time, to stand in for minutes passing. */
  async function ageAttempts(email: string, minutes: number): Promise<void> {
    const rows = await harness.control.db
      .select({ id: authAttempts.id, at: authAttempts.createdAt })
      .from(authAttempts)
      .where(eq(authAttempts.subject, email.toLowerCase()));
    for (const row of rows) {
      await harness.control.db
        .update(authAttempts)
        .set({ createdAt: new Date(row.at.getTime() - minutes * 60_000) })
        .where(eq(authAttempts.id, row.id));
    }
  }

  it("locks an account after 5 wrong passwords, refusing even the right one", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    for (let n = 0; n < 5; n += 1) expect((await attempt(email)).status).toBe(401);
    const locked = await attempt(email, true);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("account_locked");
    expect(locked.body.message).toMatch(/15 minutes/);
  });

  it("ends the lock on its own after 15 minutes", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    for (let n = 0; n < 5; n += 1) await attempt(email);
    expect((await attempt(email, true)).status).toBe(429);
    await ageAttempts(email, 16);
    expect((await attempt(email, true)).status).toBe(200);
  });

  it("does not lock when the failures are spread over more than 15 minutes", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    for (let n = 0; n < 4; n += 1) await attempt(email);
    await ageAttempts(email, 16);
    await attempt(email);
    expect((await attempt(email, true)).status).toBe(200);
  });

  it("resets the count after a successful sign-in", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    for (let n = 0; n < 4; n += 1) await attempt(email);
    expect((await attempt(email, true)).status).toBe(200);
    for (let n = 0; n < 4; n += 1) await attempt(email);
    expect((await attempt(email, true)).status).toBe(200);
  });

  it("locks an address with no account the same way, so nothing is revealed", async () => {
    const email = `nobody-${uuidv7()}@example.test`;
    for (let n = 0; n < 5; n += 1) expect((await attempt(email)).status).toBe(401);
    const locked = await attempt(email);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("account_locked");
  });

  it("counts the address whatever its letter case", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    for (let n = 0; n < 5; n += 1) await attempt(n % 2 ? email.toUpperCase() : email);
    expect((await attempt(email, true)).status).toBe(429);
  });

  it("allows 10 sign-in attempts a minute from one IP address, then answers 429", async () => {
    const ip = "203.0.113.10";
    for (let n = 0; n < 10; n += 1) {
      expect((await attempt(`rate-${n}-${uuidv7()}@example.test`, false, ip)).status).toBe(401);
    }
    const limited = await attempt(`rate-last-${uuidv7()}@example.test`, false, ip);
    expect(limited.status).toBe(429);
    expect((await attempt(`other-ip-${uuidv7()}@example.test`, false, "203.0.113.11")).status).toBe(401);
  });

  it("ignores a spoofed X-Forwarded-For: the limit follows the client IP the proxy vouches for", async () => {
    const ip = "203.0.113.20";
    for (let n = 0; n < 10; n += 1) {
      await harness
        .post("/api/auth/sign-in/email", undefined, ip)
        .set("X-Forwarded-For", `198.18.0.${n}`)
        .send({ email: `spoof-${n}-${uuidv7()}@example.test`, password: "wrong-password-123" });
    }
    const limited = await harness
      .post("/api/auth/sign-in/email", undefined, ip)
      .set("X-Forwarded-For", "198.18.1.1")
      .send({ email: `spoof-last-${uuidv7()}@example.test`, password: "wrong-password-123" });
    expect(limited.status).toBe(429);
  });

  it("checks at most 5 of many parallel guesses before the lock applies", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    const answers = await Promise.all(Array.from({ length: 12 }, () => attempt(email)));
    const checked = answers.filter((answer) => answer.status === 401).length;
    expect(checked).toBeLessThanOrEqual(5);
    expect(answers.filter((answer) => answer.status === 429).length).toBeGreaterThanOrEqual(7);
    expect((await attempt(email, true)).status).toBe(429);
  });

  it("sends at most 3 verification emails an hour to one address", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID], verified: false });
    for (let n = 0; n < 5; n += 1) expect((await attempt(email, true)).status).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(harness.outbox.sent.filter((message) => message.to.includes(email))).toHaveLength(3);
  });

  it("sends at most 3 verification emails even when the requests arrive in parallel", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID], verified: false });
    await Promise.all(Array.from({ length: 8 }, () => attempt(email, true)));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.outbox.sent.filter((message) => message.to.includes(email))).toHaveLength(3);
  });

  /** One check of the password on a signed-in endpoint; a wrong password unless `right` is set. */
  function verifyPassword(cookie: string, right = false) {
    return harness
      .post("/api/auth/verify-password")
      .set("Cookie", cookie)
      .send({ password: right ? PASSWORD : `${PASSWORD}-wrong` });
  }

  it("counts wrong passwords on signed-in endpoints towards the same lockout", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    const cookie = await harness.signIn(email);
    for (let n = 0; n < 5; n += 1) expect((await verifyPassword(cookie)).status).not.toBe(200);
    const locked = await verifyPassword(cookie, true);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("account_locked");
    expect((await attempt(email, true)).status).toBe(429);
  });

  it("resets the count when a signed-in endpoint gets the right password", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    const cookie = await harness.signIn(email);
    for (let n = 0; n < 4; n += 1) await verifyPassword(cookie);
    await verifyPassword(cookie, true).expect(200);
    for (let n = 0; n < 4; n += 1) await verifyPassword(cookie);
    expect((await attempt(email, true)).status).toBe(200);
  });

  it("refuses auth requests that did not come through the web proxy", async () => {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
    for (const secret of [undefined, "not-the-secret"]) {
      const direct = request(harness.app.getHttpServer())
        .post("/api/auth/sign-in/email")
        .set("Origin", WEB_ORIGIN)
        .set("X-Client-IP", "203.0.113.30");
      const response = await (secret ? direct.set("X-Proxy-Secret", secret) : direct).send({
        email,
        password: PASSWORD,
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("proxy_required");
    }
  });
});
