import { describe, expect, it } from "vitest";
import { totpCode, totpSecretFromUri } from "../src/totp";

describe("totpCode (RFC 6238 test vectors, SHA-1)", () => {
  // RFC 6238 appendix B: the ASCII secret "12345678901234567890", here in base32.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("gives the RFC code at %i seconds", (seconds, code) => {
    expect(totpCode(secret, new Date(seconds * 1000))).toBe(code);
  });

  it("reads the secret from an otpauth URI", () => {
    expect(totpSecretFromUri(`otpauth://totp/App:me?secret=${secret}&issuer=App`)).toBe(secret);
  });
});
