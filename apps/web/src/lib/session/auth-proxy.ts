import { AUTH_PROXY_HEADERS } from "@workspace/shared";
import { AUTH_BASE_PATH } from "./auth-cookie";

/**
 * The browser's IP as the hosting edge reports it: the first `x-forwarded-for` entry. The web host
 * must run behind an edge that overwrites that header (Vercel does), so the browser cannot choose
 * it (ADR 0029, part 2; docs/blueprint-delta.md).
 */
function edgeClientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/**
 * Prepares the headers of a request the web host forwards to apps/api. Copies of the proxy headers
 * that the browser sent are always removed. On auth requests the client IP and, when configured,
 * AUTH_PROXY_SECRET are added, so the API's per-IP limits count the real browser and a direct
 * caller cannot pick its own bucket. The secret is a request header to the API only; it never
 * reaches a response.
 */
export function withAuthProxyHeaders(headers: Headers, pathname: string, secret: string | undefined): Headers {
  headers.delete(AUTH_PROXY_HEADERS.clientIp);
  headers.delete(AUTH_PROXY_HEADERS.proxySecret);
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return headers;
  const ip = edgeClientIp(headers);
  if (ip) headers.set(AUTH_PROXY_HEADERS.clientIp, ip);
  if (secret) headers.set(AUTH_PROXY_HEADERS.proxySecret, secret);
  return headers;
}
