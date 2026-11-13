import { cookies, headers } from "next/headers";
import type { ProductKey } from "@workspace/shared";
import { isDemoMode } from "../data-source";
import { PRODUCT_HEADER } from "../product";
import { toCompanySession, type SessionContext } from "./api-context";
import { AUTH_SESSION_COOKIES } from "./auth-cookie";
import { SESSION_COOKIE, verifySession, type DemoSession } from "./session";

/** The product this request's host serves, as resolved by the proxy. */
export async function requestProduct(): Promise<ProductKey> {
  return (await headers()).get(PRODUCT_HEADER) === "hr" ? "hr" : "flooring";
}

/**
 * The real session as apps/api sees it (GET /auth/context), or null when signed out or when a
 * timeout ended the session. Only in api mode. The browser's host is forwarded so the API applies
 * the same company rules as on sign-in.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const jar = await cookies();
  const sent = AUTH_SESSION_COOKIES.filter((name) => jar.has(name)).map((name) => `${name}=${jar.get(name)?.value}`);
  if (sent.length === 0) return null;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiUrl}/auth/context`, {
    headers: { cookie: sent.join("; "), "x-forwarded-host": (await headers()).get("host") ?? "" },
    cache: "no-store",
  });
  return response.ok ? ((await response.json()) as SessionContext) : null;
}

/**
 * The current session, or null. In demo mode it is the signed demo cookie, and a session made on
 * the other product's host does not count, so the HR host never opens a flooring session (spec
 * "HR host"). In api mode it is the real session, bridged to the same shape (api-context.ts).
 */
export async function getSession(): Promise<DemoSession | null> {
  if (!isDemoMode()) {
    const context = await getSessionContext();
    return context ? toCompanySession(context, await requestProduct()) : null;
  }
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return session.product === (await requestProduct()) ? session : null;
}
