import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("CONNECTION_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return key;
}

/**
 * Encrypts a company connection string with AES-256-GCM before it is stored in tenant_databases
 * (blueprint "Security": secrets). Output: `v1:` + base64(iv | auth tag | ciphertext). The
 * version prefix lets a later key rotation tell old values from new ones.
 */
export function encryptSecret(plain: string, base64Key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(base64Key), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

/** Decrypts a value from encryptSecret; a wrong key or a changed value throws instead of returning garbage. */
export function decryptSecret(stored: string, base64Key: string): string {
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) throw new Error("Unknown encrypted value format.");
  const data = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(base64Key), data.subarray(0, IV_BYTES));
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}
