/** The hosts a local-only helper or seed may reach: this machine only. */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/**
 * The only query option a local database URL may carry. postgres.js reads `host`, `hostaddr` and
 * `port` from the query over the URL's own, and parses `#` differently from WHATWG URL, so any
 * other option or a `#` could send a guarded helper elsewhere (security review, 2026-11-20).
 */
const ALLOWED_URL_OPTIONS: ReadonlySet<string> = new Set(["sslmode"]);

/**
 * The schemes a local database URL may use. For these WHATWG URL keeps the host exactly as written;
 * for `http:` and the like it rewrites hosts such as `0177.0.0.1` that postgres.js would resolve raw.
 */
const ALLOWED_URL_PROTOCOLS: ReadonlySet<string> = new Set(["postgres:", "postgresql:"]);

/** Control characters, spaces and backslashes: WHATWG URL drops or rewrites them, postgres.js doesn't. */
const UNSAFE_URL_CHARACTERS = /[\u0000- \u007f\\]/;

/**
 * Whether a database URL could make postgres.js connect somewhere other than what WHATWG URL
 * reads: a scheme other than `postgres:` or `postgresql:`, a fragment, a query option other than `sslmode`, a control character, space or backslash
 * (which WHATWG drops or rewrites before parsing and postgres.js keeps), or a scheme not followed
 * at once by `//` (postgres.js takes the authority after the first `://` it finds). The guards
 * refuse such a URL rather than reason about it (security reviews, 2026-11-20).
 */
export function redirectableUrl(url: string, parsed: URL): boolean {
  return (
    !ALLOWED_URL_PROTOCOLS.has(parsed.protocol) ||
    url.includes("#") ||
    UNSAFE_URL_CHARACTERS.test(url) ||
    !url.startsWith(`${parsed.protocol}//`) ||
    [...parsed.searchParams.keys()].some((key) => !ALLOWED_URL_OPTIONS.has(key))
  );
}

/**
 * Whether a database URL names this machine (localhost or 127.0.0.1) and can't be redirected
 * elsewhere (`redirectableUrl`). The local-only seeds (ADR 0065) and the test helpers rely on it;
 * a URL that does not parse is not local.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(parsed.hostname) && !redirectableUrl(url, parsed);
}
