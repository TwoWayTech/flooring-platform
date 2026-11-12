import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto";

const key = randomBytes(32).toString("base64");
const url = "postgres://company_summit:secret@db.example.com:5432/company_summit";

describe("connection string encryption", () => {
  it("round-trips and never stores the plain value", () => {
    const stored = encryptSecret(url, key);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("secret");
    expect(decryptSecret(stored, key)).toBe(url);
  });

  it("uses a fresh IV, so the same value encrypts differently each time", () => {
    expect(encryptSecret(url, key)).not.toBe(encryptSecret(url, key));
  });

  it("refuses a wrong key, a changed value and a short key", () => {
    const stored = encryptSecret(url, key);
    expect(() => decryptSecret(stored, randomBytes(32).toString("base64"))).toThrow();
    const tampered = `v1:${Buffer.from(Buffer.from(stored.slice(3), "base64").map((byte, i) => (i === 40 ? byte ^ 1 : byte))).toString("base64")}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => encryptSecret(url, randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
