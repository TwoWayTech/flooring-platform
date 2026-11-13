import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodes an RFC 4648 base32 secret, as authenticator apps read it from an otpauth URI. */
function base32Bytes(secret: string): Buffer {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("The TOTP secret is not base32.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/**
 * The 6-digit code an authenticator app shows for a base32 secret at a moment (RFC 6238: SHA-1,
 * 30-second steps), for tests that enrol and use MFA without a phone (`@workspace/db/testing`).
 */
export function totpCode(secret: string, at: Date = new Date()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const hmac = createHmac("sha1", base32Bytes(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

/** The secret in an otpauth:// URI, as Better Auth's enable endpoint returns it. */
export function totpSecretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("The otpauth URI has no secret.");
  return secret;
}
