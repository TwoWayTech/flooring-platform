import { platformAdmins, products, tenantProducts } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import type { ProductKey } from "@workspace/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { expect } from "vitest";
import { PASSWORD, sessionCookie, SUMMIT_ID, WEB_ORIGIN, type AuthHarness } from "../auth-harness";
import type { HttpMethod } from "./routes";

/** The browser the platform tests pretend to be, so the platform audit rows can be checked for it. */
export const AGENT = "platform-console-test";

/** A TOTP code for the next 30-second step, so a code is never used twice in one step. */
export function freshCode(secret: string): string {
  return totpCode(secret, new Date(Date.now() + 30_000));
}

/** A signed-in platform admin with an enrolled authenticator app, as the platform tests use one. */
export interface EnrolledAdmin {
  email: string;
  cookie: string;
  secret: string;
  userId: string;
}

/**
 * Helpers the platform console's API tests share (docs/specs/platform-admin.md; ADR 0052 and
 * ADR 0053), bound to one harness: requests as the web proxy sends them, admins with a
 * `platform_admins` row and an authenticator app, the step-up, and companies with no database of
 * their own.
 */
export function platformHelpers(harness: AuthHarness) {
  /** A request as the web app's proxy sends it, from the test browser. */
  function call(method: HttpMethod, path: string, cookie?: string) {
    const pending = request(harness.app.getHttpServer())
      [method](path)
      .set("Origin", WEB_ORIGIN)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("User-Agent", AGENT);
    return cookie ? pending.set("Cookie", cookie) : pending;
  }

  /** Signs in a user whose roles need MFA, enrols an authenticator app, and returns the session. */
  async function enrolled(email: string): Promise<EnrolledAdmin> {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    expect(confirmed.status).toBe(200);
    return {
      email,
      cookie: sessionCookie(confirmed.headers["set-cookie"]),
      secret,
      userId: await harness.userIdOf(email),
    };
  }

  /** A step-up with a fresh code, so the admin's next platform write is allowed. */
  async function stepUp(who: { cookie: string; secret: string }): Promise<void> {
    await harness
      .post("/auth/step-up")
      .set("Cookie", who.cookie)
      .send({ code: freshCode(who.secret) })
      .expect(204);
  }

  /** A Summit sales user with a platform_admins row; `role` may be one the console does not accept. */
  async function adminEmail(role: string, row: { active?: boolean; deleted?: boolean } = {}): Promise<string> {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] });
    const userId = await harness.userIdOf(email);
    await harness.control.db.insert(platformAdmins).values({
      userId,
      role: "support",
      active: row.active ?? true,
      deletedAt: row.deleted ? new Date() : null,
    });
    // The column is free text with no CHECK (review A4), so a test can store any value.
    await harness.control.db.execute(sql`update platform_admins set role = ${role} where user_id = ${userId}`);
    return email;
  }

  /** The id of a seeded product. */
  async function productId(key: ProductKey): Promise<string> {
    return (await harness.control.db.select({ id: products.id }).from(products).where(eq(products.key, key)))[0].id;
  }

  /** A company with no database of its own, on one product (Flooring Suite by default), as provisioning leaves it. */
  async function companyOn(slug: string, product: ProductKey = "flooring"): Promise<string> {
    const id = await harness.addCompany(`${slug}${Date.now()}`);
    await harness.control.db.insert(tenantProducts).values({ tenantId: id, productId: await productId(product) });
    return id;
  }

  return { call, enrolled, stepUp, adminEmail, productId, companyOn };
}
