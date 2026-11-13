/**
 * Headers between the web host and apps/api for proxied auth requests (ADR 0029, part 2). The web
 * proxy sets both and removes any copies the browser sent. The API trusts the client IP only when
 * the proxy secret matches, so a direct caller cannot choose its own rate-limit bucket.
 */
export const AUTH_PROXY_HEADERS = {
  /** The browser's IP as the web host saw it; Better Auth's per-IP limits read only this. */
  clientIp: "x-client-ip",
  /** The shared AUTH_PROXY_SECRET, proving the request came through our web proxy. */
  proxySecret: "x-proxy-secret",
} as const;
