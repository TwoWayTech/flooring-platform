import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading the repository's source as text for the whole-product check's static scans (coverage
 * list, page gates, money in the UI; ADR 0058). The scans use only `node:fs` and regular
 * expressions, so they add no dependency and read code exactly as it is committed.
 */

/** The repository root, with a trailing separator. */
export const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));

/** A repository-relative path, always with forward slashes, as the generated files print it. */
export function repoRelative(absolute: string): string {
  return relative(REPO, absolute).split(sep).join("/");
}

/** The absolute path of a repository-relative one. */
export function repoPath(path: string): string {
  return join(REPO, path);
}

/** A repository file's text. */
export function readRepoFile(path: string): string {
  return readFileSync(repoPath(path), "utf8");
}

/** Every file under a repository directory whose path passes `keep`, repository-relative and sorted. */
export function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (absolute: string) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(absolute, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (keep(repoRelative(path))) found.push(repoRelative(path));
    }
  };
  walk(repoPath(dir));
  return found.sort();
}

/** The names in one repository directory (no recursion), sorted. */
export function namesIn(dir: string): string[] {
  return readdirSync(repoPath(dir)).sort();
}

/**
 * The text with every `//` and `/* *\/` comment blanked to spaces, newlines kept, so indices and
 * line numbers stay those of the file and JSDoc that names a method or a route is never read as
 * code. Quoted strings and template literals are skipped over; regular-expression literals are
 * not parsed, which is enough because no screen regex holds two slashes in a row.
 */
export function withoutComments(text: string): string {
  const out = text.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' || char === "'" || char === "`") {
      i = endOfQuoted(text, i);
    } else if (char === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/** The index just after the quoted string or template literal that starts at `start`. */
function endOfQuoted(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === quote) return i + 1;
    else if (quote !== "`" && text[i] === "\n") return i;
    else i += 1;
  }
  return i;
}

/** The 1-based line of an index in a text. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line += 1;
  return line;
}

/**
 * The text between the parenthesis at `open` and its matching close, quoted strings skipped, or
 * null when it never closes.
 */
export function insideParens(text: string, open: number): string | null {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      i = endOfQuoted(text, i);
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
    i += 1;
  }
  return null;
}

/**
 * An API path as the route catalog writes it, with every parameter as `:p` and no query, so a
 * screen's `/invoices/${id}/void`, a test's `/invoices/:id/void` and the catalog's
 * `/invoices/:id/void` all compare equal.
 */
export function normalPath(path: string): string {
  const noQuery = path.split("?")[0] ?? "";
  const params = noQuery.replace(/\$\{[^}]*\}/g, ":p").replace(/:[A-Za-z_]\w*/g, ":p");
  const trimmed = params.length > 1 ? params.replace(/\/+$/, "") : params;
  return trimmed === "" ? "/" : trimmed;
}
