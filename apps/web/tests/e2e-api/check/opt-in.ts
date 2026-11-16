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

/** The hosts a check spec may write companies on: this machine only. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/**
 * Throws unless a database URL is on this machine and, outside CI, on the throwaway port. Never
 * puts the URL in the message, because it holds a password.
 */
function refuseUnlessThrowaway(name: string, url: string | undefined): string {
  if (!url) throw new Error(`Set ${name}: the check specs need the throwaway e2e database.`);
  const parsed = new URL(url);
  const overridden = [...parsed.searchParams.keys()].some((key) => key === "host" || key === "hostaddr");
  const local = LOCAL_HOSTS.has(parsed.hostname) && !overridden;
  if (!local || (!process.env.CI && parsed.port !== THROWAWAY_PORT)) {
    throw new Error(
      `${name} must point at the throwaway e2e database on this machine (port ${THROWAWAY_PORT} outside CI); ` +
        "the check specs provision and drop companies there.",
    );
  }
  return url;
}

/**
 * The throwaway server a check spec provisions on, from the environment the API under test uses:
 * the control database, the server's superuser login and the encryption key. Outside CI it
 * refuses unless both database URLs are on this machine's port 5433, so a spec never writes a
 * company into a developer's own databases; in CI the job's own PostgreSQL is throwaway too.
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
