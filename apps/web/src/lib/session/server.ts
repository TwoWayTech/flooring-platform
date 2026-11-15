import { cookies, headers } from "next/headers";
import type { ProductKey } from "@workspace/shared";
import { isDemoMode } from "../data-source";
import { PRODUCT_HEADER } from "../product";
import { toCompanySession, type SessionContext } from "./api-context";
import { AUTH_SESSION_COOKIES } from "./auth-cookie";
import { platformGateOf, type PlatformGate } from "./platform-gate";
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
  const response = await fetchWithSession("/auth/context");
  return response?.ok ? ((await response.json()) as SessionContext) : null;
}

/**
 * Calls apps/api from the server with the browser's auth cookies and host, as the browser would;
 * null when no auth cookie was sent, so a signed-out request never reaches the API.
 */
async function fetchWithSession(path: string): Promise<Response | null> {
  const jar = await cookies();
  const sent = AUTH_SESSION_COOKIES.filter((name) => jar.has(name)).map((name) => `${name}=${jar.get(name)?.value}`);
  if (sent.length === 0) return null;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return fetch(`${apiUrl}${path}`, {
    headers: { cookie: sent.join("; "), "x-forwarded-host": (await headers()).get("host") ?? "" },
    cache: "no-store",
  });
}

/**
 * Whether this request may open /admin (docs/specs/platform-admin.md, "Screens", Layout). In demo
 * mode it is the "Platform admin (you)" session. In api mode the API decides through
 * GET /platform/me, which reads the platform_admins row on every request; any failure denies.
 */
export async function getPlatformGate(): Promise<PlatformGate> {
  if (isDemoMode()) {
    const session = await getSession();
    if (!session) return { kind: "signed_out" };
    return session.kind === "platform" ? { kind: "admin", role: "owner" } : { kind: "not_admin" };
  }
  const response = await fetchWithSession("/platform/me").catch(() => undefined);
  if (response === null) return { kind: "signed_out" };
  if (!response) return { kind: "not_admin" };
  return platformGateOf(response.status, await response.json().catch(() => null));
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
