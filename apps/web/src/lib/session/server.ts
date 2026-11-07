import { cookies, headers } from "next/headers";
import type { ProductKey } from "@workspace/shared";
import { PRODUCT_HEADER } from "../product";
import { SESSION_COOKIE, verifySession, type DemoSession } from "./session";

/** The product this request's host serves, as resolved by the proxy. */
export async function requestProduct(): Promise<ProductKey> {
  return (await headers()).get(PRODUCT_HEADER) === "hr" ? "hr" : "flooring";
}

/**
 * The current demo session, or null. A session made on the other product's host does not count,
 * so the HR host never opens a flooring session (spec "HR host").
 */
export async function getSession(): Promise<DemoSession | null> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return session.product === (await requestProduct()) ? session : null;
}
