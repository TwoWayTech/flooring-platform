import { test } from "@playwright/test";
import type { FreshTestServer } from "@workspace/db/testing";

/**
 * The whole-product check's browser specs (tests/e2e-api/check, tagged @check) are opt-in, because
 * the default api-mode run already sits near CI's verify timeout (ADR 0058, S-1). Run them with
 * `WHOLE_CHECK=1`, against a build made with NEXT_PUBLIC_DATA_SOURCE=api, e.g.
 * `WHOLE_CHECK=1 pnpm --filter web test:e2e:api tests/e2e-api/check`. Without the flag they show
 * as skipped. Call at the top of a describe block.
 */
export function checkOnly(): void {
  test.skip(process.env.WHOLE_CHECK !== "1", "opt-in: WHOLE_CHECK=1");
}

/** The port of the throwaway api-mode e2e database; a developer's own databases are on 5432. */
const THROWAWAY_PORT = "5433";

/**
 * Whether the run is GitHub Actions, whose job database is throwaway. Only that lifts the port
 * rule: a stray `CI=1` in a developer's shell must not point the specs at their own databases.
 */
const ON_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === "true";

/** The hosts a check spec may write companies on: this machine only. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/**
 * Throws unless a database URL is on this machine and, outside GitHub Actions, on the throwaway
 * port. Never puts the URL in a message, because it holds a password: a malformed URL is refused
 * with the variable's name only, since the URL parser's own error carries its input.
 */
function refuseUnlessThrowaway(name: string, url: string | undefined): string {
  if (!url) throw new Error(`Set ${name}: the check specs need the throwaway e2e database.`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a database URL.`);
  }
  const overridden = [...parsed.searchParams.keys()].some((key) => key === "host" || key === "hostaddr");
  const local = LOCAL_HOSTS.has(parsed.hostname) && !overridden;
  if (!local || (!ON_GITHUB_ACTIONS && parsed.port !== THROWAWAY_PORT)) {
    throw new Error(
      `${name} must point at the throwaway e2e database on this machine (port ${THROWAWAY_PORT} outside GitHub Actions); ` +
        "the check specs provision and drop companies there.",
    );
  }
  return url;
}

/**
 * The throwaway server a check spec provisions on, from the environment the API under test uses:
 * the control database, the server's superuser login and the encryption key. Outside GitHub
 * Actions it refuses unless both database URLs are on this machine's port 5433, so a spec never
 * writes a company into a developer's own databases; the Actions job's own PostgreSQL is throwaway.
 */
export function assertThrowawayDb(): FreshTestServer {
  const encryptionKey = process.env.CONNECTION_ENCRYPTION_KEY;
  if (!encryptionKey)
    throw new Error("Set CONNECTION_ENCRYPTION_KEY: the API under test decrypts company URLs with it.");
  return {
    controlUrl: refuseUnlessThrowaway("CONTROL_DATABASE_URL", process.env.CONTROL_DATABASE_URL),
    adminUrl: refuseUnlessThrowaway("TENANT_DB_ADMIN_URL", process.env.TENANT_DB_ADMIN_URL),
    encryptionKey,
  };
}
