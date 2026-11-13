import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, settleClientIp } from "../src/core/auth/client-ip";

const SECRET = "proxy-secret-for-tests-0123456789abcdef";

function request(headers: Record<string, string>, socketIp = "10.0.0.5"): IncomingMessage {
  return { headers: { ...headers }, socket: { remoteAddress: socketIp } } as unknown as IncomingMessage;
}

describe("settleClientIp (ADR 0029, part 2: the per-IP limits trust only the web proxy)", () => {
  it("keeps the forwarded client IP when the proxy secret matches, and drops the secret", () => {
    const req = request({ [CLIENT_IP_HEADER]: "203.0.113.7", [PROXY_SECRET_HEADER]: SECRET });
    expect(settleClientIp(req, SECRET)).toBe(true);
    expect(req.headers[CLIENT_IP_HEADER]).toBe("203.0.113.7");
    expect(req.headers[PROXY_SECRET_HEADER]).toBeUndefined();
  });

  it("refuses a request whose secret is missing or wrong, and never trusts its IP", () => {
    const missing = request({ [CLIENT_IP_HEADER]: "203.0.113.7" });
    expect(settleClientIp(missing, SECRET)).toBe(false);
    expect(missing.headers[CLIENT_IP_HEADER]).toBe("10.0.0.5");
    const wrong = request({ [CLIENT_IP_HEADER]: "203.0.113.7", [PROXY_SECRET_HEADER]: `${SECRET}x` });
    expect(settleClientIp(wrong, SECRET)).toBe(false);
    expect(wrong.headers[CLIENT_IP_HEADER]).toBe("10.0.0.5");
    expect(wrong.headers[PROXY_SECRET_HEADER]).toBeUndefined();
  });

  it("lets a proxied request with no client IP through, counted by the socket address", () => {
    const req = request({ [PROXY_SECRET_HEADER]: SECRET });
    expect(settleClientIp(req, SECRET)).toBe(true);
    expect(req.headers[CLIENT_IP_HEADER]).toBe("10.0.0.5");
  });

  it("keeps the forwarded value without a configured secret (development)", () => {
    const req = request({ [CLIENT_IP_HEADER]: "203.0.113.7" });
    expect(settleClientIp(req, undefined)).toBe(true);
    expect(req.headers[CLIENT_IP_HEADER]).toBe("203.0.113.7");
  });
});
