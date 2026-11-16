import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { filesUnder, lineAt, readRepoFile, repoPath, repoRelative, withoutComments } from "./source";

/**
 * The static scan of the web app's screens for the coverage list (whole-product check, ADR 0058):
 * every page and layout under apps/web/src/app, the source files each one reaches through its
 * imports, and every ApiClient call in those files (CLAUDE.md rule 1: screens read and write only
 * through the ApiClient). `src/lib/api/**` is the client itself and is never followed.
 */

const APP_DIR = "apps/web/src/app";
const WEB_SRC = "apps/web/src";
const CLIENT_DIR = "apps/web/src/lib/api/";

/** One ApiClient call: the method, or `list:<collection>` (also `get:` and `save:`), and where. */
export interface ClientCall {
  target: string;
  file: string;
  line: number;
}

/** A page or layout of the web app, the files it reaches and the ApiClient calls in them. */
export interface Screen {
  /** A page's route (`[id]` as `*`, groups dropped), or a layout's folder (`(app)/settings`, `root`). */
  route: string;
  file: string;
  kind: "page" | "layout";
  /** For a page: the layouts that wrap it, outermost first, by their `route`. */
  layouts: string[];
  calls: ClientCall[];
}

/** The page route a `page.tsx` serves: groups dropped, `[id]` as `*`, a catch-all kept as written. */
export function pageRoute(file: string): string {
  const parts = dirname(file.slice(APP_DIR.length + 1))
    .split("/")
    .filter((part) => part !== "." && !/^\(.+\)$/.test(part))
    .map((part) => (/^\[[^.].*\]$/.test(part) ? "*" : part));
  return `/${parts.join("/")}`;
}

/** A layout's name: its folder under app, groups kept, or `root`. */
function layoutName(file: string): string {
  const folder = dirname(file.slice(APP_DIR.length + 1));
  return folder === "." ? "root" : folder;
}

/** The source file an import specifier names, or null for packages and files outside the scan. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(WEB_SRC, specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = join(dirname(fromFile), specifier);
  else return null;
  const candidates = /\.(ts|tsx)$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  const found = candidates.find((candidate) => existsSync(repoPath(candidate)));
  return found ? repoRelative(repoPath(found)) : null;
}

/** Whether an import clause brings in types only (`import type …`, or braces of `type` names only). */
function typeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) return true;
  const braces = /^\{([^}]*)\}$/.exec(trimmed);
  if (!braces) return false;
  const names = (braces[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

/** The repository files a source file imports at run time (`import`, `export … from`, `import()`). */
export function importsOf(file: string, code: string): string[] {
  const found = new Set<string>();
  const statement = /(?:^|[;\n])\s*(?:import|export)\s+([^"';]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of code.matchAll(statement)) {
    if (typeOnly(match[1] ?? "")) continue;
    const resolved = resolveImport(file, match[2] ?? "");
    if (resolved) found.add(resolved);
  }
  const bare = /(?:^|[;\n])\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of code.matchAll(bare)) {
    const resolved = resolveImport(file, match[1] ?? match[2] ?? "");
    if (resolved) found.add(resolved);
  }
  return [...found].filter((path) => !path.startsWith(CLIENT_DIR)).sort();
}

/**
 * The names that hold the ApiClient in a file: `api` when the file imports it from the client,
 * `client` (the name every `useApiQuery` reader uses), and any parameter typed `ApiClient` or
 * `Pick<ApiClient, …>`.
 */
function receiversIn(code: string): string[] {
  const names = new Set(["client"]);
  if (/import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*["'](?:@\/lib\/api|(?:\.\.?\/)+(?:lib\/)?api)["']/.test(code)) {
    names.add("api");
  }
  for (const match of code.matchAll(/\b([A-Za-z_]\w*)\s*:\s*(?:Pick<\s*)?ApiClient\b/g)) names.add(match[1] ?? "");
  return [...names];
}

/** The ApiClient calls in one file: `<receiver>.<method>(`, with a literal collection for list, get and save. */
export function callsIn(file: string, code: string): ClientCall[] {
  const receivers = receiversIn(code).join("|");
  const call = new RegExp(
    `\\b(?:${receivers})\\s*\\.\\s*([A-Za-z_]\\w*)\\s*(?:<[^>()]*>)?\\s*\\(\\s*(?:["']([A-Za-z]\\w*)["'])?`,
    "g",
  );
  const calls: ClientCall[] = [];
  for (const match of code.matchAll(call)) {
    const method = match[1] ?? "";
    const collection = match[2];
    const keyed = method === "list" || method === "get" || method === "save";
    const target = keyed ? `${method}:${collection ?? "?"}` : method;
    calls.push({ target, file, line: lineAt(code, match.index ?? 0) });
  }
  return calls;
}

/** One file's run-time imports and ApiClient calls, read once. */
interface FileFacts {
  imports: string[];
  calls: ClientCall[];
}

/** Every file reachable from `start` through run-time imports, `start` included, sorted. */
function reachable(start: string, facts: (file: string) => FileFacts): string[] {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const next of facts(file).imports) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen].sort();
}

/** Every page and layout of the web app with the ApiClient calls reachable from it, sorted by route. */
export function scanScreens(): Screen[] {
  const cache = new Map<string, FileFacts>();
  const facts = (file: string): FileFacts => {
    const known = cache.get(file);
    if (known) return known;
    const code = withoutComments(readRepoFile(file));
    const read = { imports: importsOf(file, code), calls: callsIn(file, code) };
    cache.set(file, read);
    return read;
  };
  const files = filesUnder(APP_DIR, (path) => /\/(page|layout)\.tsx$/.test(path));
  const layouts = files.filter((file) => file.endsWith("/layout.tsx"));
  const screen = (file: string): Screen => {
    const isPage = file.endsWith("/page.tsx");
    const folder = dirname(file);
    const wrapping = layouts
      .filter((layout) => isPage && (folder + "/").startsWith(dirname(layout) + "/"))
      .sort((a, b) => a.length - b.length)
      .map(layoutName);
    const calls = reachable(file, facts).flatMap((reached) => facts(reached).calls);
    return {
      route: isPage ? pageRoute(file) : layoutName(file),
      file,
      kind: isPage ? "page" : "layout",
      layouts: wrapping,
      calls: calls.sort((a, b) => a.target.localeCompare(b.target) || a.file.localeCompare(b.file) || a.line - b.line),
    };
  };
  return files.map(screen).sort((a, b) => a.kind.localeCompare(b.kind) || a.route.localeCompare(b.route));
}
