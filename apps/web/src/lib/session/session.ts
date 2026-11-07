import { jwtVerify, SignJWT } from "jose";
import type { CompanyId, DefaultRoleKey, ProductKey } from "@workspace/shared";

/** httpOnly cookie holding the signed demo session. */
export const SESSION_COOKIE = "demo_session";
/** A presenter session lasts a working day. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Signed in as a persona of one company. */
export interface CompanySession {
  kind: "company";
  companyId: CompanyId;
  product: ProductKey;
  userId: string;
  roleKey: DefaultRoleKey;
}

/** Signed in as the platform super-admin (the "Platform admin (you)" card). */
export interface PlatformSession {
  kind: "platform";
  product: ProductKey;
}

/** What the demo session cookie records: who the presenter picked, nothing more (ADR 0001). */
export type DemoSession = CompanySession | PlatformSession;

/**
 * Signing key. On Vercel set DEMO_SESSION_SECRET; locally a clearly labelled non-secret key lets
 * the demo run with zero setup. The cookie protects no real data (ADR 0001).
 */
function signingKey(): Uint8Array {
  const key = process.env.DEMO_SESSION_SECRET ?? "local-demo-key-not-secret-set-DEMO_SESSION_SECRET-on-vercel";
  return new TextEncoder().encode(key);
}

/** Signs a session as an HS256 JWT for the cookie. */
export async function signSession(session: DemoSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(signingKey());
}

/** Verifies a session token; returns null when it is missing, expired or tampered with. */
export async function verifySession(token: string | undefined): Promise<DemoSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] });
    return payload.kind === "company" || payload.kind === "platform" ? (payload as unknown as DemoSession) : null;
  } catch {
    return null;
  }
}
