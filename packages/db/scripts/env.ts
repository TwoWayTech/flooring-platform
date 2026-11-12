/**
 * Settings for the database scripts. Values come from the environment (a local .env is loaded by
 * the npm scripts); without them the scripts fall back to the docker-compose server. The local
 * encryption key below is public and labelled as such: it is refused for any non-local database.
 */
const LOCAL = {
  CONTROL_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/control",
  TENANT_DB_ADMIN_URL: "postgres://postgres:postgres@localhost:5432/postgres",
  CONNECTION_ENCRYPTION_KEY: Buffer.from("local-docker-only-not-a-secret!!").toString("base64"),
};

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** Shortest password Better Auth accepts (blueprint p27); the seed password must meet it too. */
const MIN_PASSWORD_LENGTH = 12;

/** SEED_USER_PASSWORD, checked: undefined when unset, an error when shorter than the sign-in minimum. */
function seedUserPassword(): string | undefined {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) return undefined;
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_USER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

/** The control URL, the admin URL, the encryption key and the seed password, checked. */
export function scriptEnv() {
  const controlUrl = process.env.CONTROL_DATABASE_URL ?? LOCAL.CONTROL_DATABASE_URL;
  const adminUrl = process.env.TENANT_DB_ADMIN_URL ?? LOCAL.TENANT_DB_ADMIN_URL;
  const encryptionKey =
    process.env.CONNECTION_ENCRYPTION_KEY ?? (isLocal(controlUrl) ? LOCAL.CONNECTION_ENCRYPTION_KEY : "");
  if (!encryptionKey) throw new Error("Set CONNECTION_ENCRYPTION_KEY (docs/environment.md).");
  return {
    controlUrl,
    adminUrl,
    encryptionKey,
    provider: process.env.DB_PROVIDER ?? "postgres",
    userPassword: seedUserPassword(),
  };
}
