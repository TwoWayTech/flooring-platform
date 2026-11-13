import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { AUTH_PROXY_HEADERS } from "@workspace/shared";

/**
 * The header that carries the browser's IP from the web host to the API (ADR 0029, part 2). The
 * web proxy always overwrites it, and Better Auth's per-IP limits read only this header, never
 * `x-forwarded-for`, which a browser can set and the Next.js proxy passes on unchanged.
 */
export const CLIENT_IP_HEADER = AUTH_PROXY_HEADERS.clientIp;

/** The header with the shared secret that proves a request came through our web proxy. */
export const PROXY_SECRET_HEADER = AUTH_PROXY_HEADERS.proxySecret;

/** Compares secrets in constant time, so the answer time reveals nothing about the secret. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Decides which client IP the auth endpoints see, and returns whether the request may reach them.
 * With AUTH_PROXY_SECRET set (required in production), only requests that carry the secret came
 * through our web proxy's auth route; anything else returns false and is refused, because its IP
 * cannot be trusted and a shared fallback address would let one caller use up or dodge everyone's
 * limits. Without the secret (development and tests) the forwarded IP is kept, or the socket
 * address when there is none. The secret header is removed either way, so nothing downstream can
 * read or log it.
 */
export function settleClientIp(request: IncomingMessage, proxySecret: string | undefined): boolean {
  const given = request.headers[PROXY_SECRET_HEADER];
  delete request.headers[PROXY_SECRET_HEADER];
  const proxied = !proxySecret || (typeof given === "string" && sameSecret(given, proxySecret));
  const forwarded = request.headers[CLIENT_IP_HEADER];
  if (proxied && typeof forwarded === "string" && forwarded !== "") return true;
  const socketIp = request.socket.remoteAddress;
  if (socketIp) request.headers[CLIENT_IP_HEADER] = socketIp;
  else delete request.headers[CLIENT_IP_HEADER];
  return proxied;
}
