import { AUTH_PROXY_HEADERS } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import { withAuthProxyHeaders } from "../../src/lib/session/auth-proxy";

const SECRET = "web-proxy-secret-for-tests-0123456789";

describe("withAuthProxyHeaders (ADR 0029, part 2: the API trusts only the IP our proxy vouches for)", () => {
  it("forwards the edge's client IP and the secret on auth requests", () => {
    const headers = withAuthProxyHeaders(
      new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
      "/api/auth/sign-in/email",
      SECRET,
    );
    expect(headers.get(AUTH_PROXY_HEADERS.clientIp)).toBe("203.0.113.7");
    expect(headers.get(AUTH_PROXY_HEADERS.proxySecret)).toBe(SECRET);
  });

  it("removes proxy headers a browser sent, on every path", () => {
    const sent = { [AUTH_PROXY_HEADERS.clientIp]: "198.18.0.1", [AUTH_PROXY_HEADERS.proxySecret]: "guess" };
    const page = withAuthProxyHeaders(new Headers(sent), "/sales", SECRET);
    expect(page.get(AUTH_PROXY_HEADERS.clientIp)).toBeNull();
    expect(page.get(AUTH_PROXY_HEADERS.proxySecret)).toBeNull();
    const auth = withAuthProxyHeaders(new Headers(sent), "/api/auth/sign-in/email", undefined);
    expect(auth.get(AUTH_PROXY_HEADERS.clientIp)).toBeNull();
    expect(auth.get(AUTH_PROXY_HEADERS.proxySecret)).toBeNull();
  });

  it("sends no secret to non-auth paths", () => {
    const headers = withAuthProxyHeaders(
      new Headers({ "x-forwarded-for": "203.0.113.7" }),
      "/api-proxy/auth/context",
      SECRET,
    );
    expect(headers.get(AUTH_PROXY_HEADERS.proxySecret)).toBeNull();
  });
});
