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
 * Decides which client IP the auth endpoints see. With AUTH_PROXY_SECRET set (required in
 * production), the forwarded `x-client-ip` is trusted only when the request carries the secret;
 * otherwise the socket address replaces it, so a direct caller cannot pick its own rate-limit
 * bucket. Without the secret (development and tests) the forwarded value is kept. The secret header
 * is removed either way, so nothing downstream can read or log it.
 */
export function settleClientIp(request: IncomingMessage, proxySecret: string | undefined): void {
  const given = request.headers[PROXY_SECRET_HEADER];
  delete request.headers[PROXY_SECRET_HEADER];
  const forwarded = request.headers[CLIENT_IP_HEADER];
  const trusted =
    typeof forwarded === "string" &&
    forwarded !== "" &&
    (!proxySecret || (typeof given === "string" && sameSecret(given, proxySecret)));
  if (trusted) return;
  const socketIp = request.socket.remoteAddress;
  if (socketIp) request.headers[CLIENT_IP_HEADER] = socketIp;
  else delete request.headers[CLIENT_IP_HEADER];
}
