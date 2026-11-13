/**
 * Better Auth's session cookie, plain locally and with the `__Secure-` prefix over HTTPS. The web
 * app only checks that one exists; apps/api verifies it (ADR 0029).
 */
export const AUTH_SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"] as const;

/** Where the web app forwards Better Auth's endpoints and the rest of apps/api (next.config.ts). */
export const AUTH_BASE_PATH = "/api/auth";
export const API_PROXY_PATH = "/api-proxy";
