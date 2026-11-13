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
    settleClientIp(req, SECRET);
    expect(req.headers[CLIENT_IP_HEADER]).toBe("203.0.113.7");
    expect(req.headers[PROXY_SECRET_HEADER]).toBeUndefined();
  });

  it("uses the socket address when the secret is missing or wrong", () => {
    const missing = request({ [CLIENT_IP_HEADER]: "203.0.113.7" });
    settleClientIp(missing, SECRET);
    expect(missing.headers[CLIENT_IP_HEADER]).toBe("10.0.0.5");
    const wrong = request({ [CLIENT_IP_HEADER]: "203.0.113.7", [PROXY_SECRET_HEADER]: `${SECRET}x` });
    settleClientIp(wrong, SECRET);
    expect(wrong.headers[CLIENT_IP_HEADER]).toBe("10.0.0.5");
  });

  it("uses the socket address when no client IP was forwarded", () => {
    const req = request({ [PROXY_SECRET_HEADER]: SECRET });
    settleClientIp(req, SECRET);
    expect(req.headers[CLIENT_IP_HEADER]).toBe("10.0.0.5");
  });

  it("keeps the forwarded value without a configured secret (development and tests)", () => {
    const req = request({ [CLIENT_IP_HEADER]: "203.0.113.7" });
    settleClientIp(req, undefined);
    expect(req.headers[CLIENT_IP_HEADER]).toBe("203.0.113.7");
  });
});
