import { filesUnder, insideParens, lineAt, readRepoFile, withoutComments } from "./source";

/**
 * Finds JavaScript numbers made from money or quantity strings in the web app's UI code (whole-product
 * check, UI-1, ADR 0058). CLAUDE.md rule 6: money, quantities and rates are decimal strings handled
 * with decimal.js and shown only through formatNumber or `<Num>`, never JS floats. `toFixed` is
 * already banned by ESLint; this scan covers `parseFloat`, `Number(…)` and unary `+`.
 */

/** The UI folders scanned. */
export const UI_DIRS = ["apps/web/src/features", "apps/web/src/components", "apps/web/src/app"] as const;

/**
 * Names that mark an expression as money, a quantity, a rate or hours: the plan's list, plus the
 * words a hand review of every `Number(` in UI code found it missed (bonus and commission sums, a
 * margin, roll lengths, stock levels, a percent change, a count-up's value). A plain `value` also
 * catches whole-number inputs; those are listed as such.
 */
export const MONEY_WORDS =
  /amount|total|price|cost|qty|quantity|sales|revenue|pct|rate|balance|paid|hours|bonus|payable|margin|deduction|pending|length|metric|change|level|value/i;

/** One conversion found: `Number(<expr>)` or `+<expr>`, where, and the expression's text. */
export interface FloatUse {
  /** `<file>: Number(<expr>)` or `<file>: +<expr>`, whitespace collapsed: the key KNOWN_FLOAT_USES uses. */
  key: string;
  file: string;
  line: number;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The `Number(…)` calls in a file whose argument names money. */
function numberCalls(file: string, code: string): FloatUse[] {
  const uses: FloatUse[] = [];
  for (const match of code.matchAll(/(?<![.\w])Number\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const inner = insideParens(code, open);
    if (inner === null || !MONEY_WORDS.test(inner)) continue;
    uses.push({ key: `${file}: Number(${collapse(inner)})`, file, line: lineAt(code, match.index ?? 0) });
  }
  return uses;
}

/** The unary `+` conversions in a file whose operand names money. */
function unaryPlus(file: string, code: string): FloatUse[] {
  const uses: FloatUse[] = [];
  const plus = /(?:[=(,:?[{!&|>]|\breturn)\s*\+(?![+=])\s*([A-Za-z_$][\w$.?[\]"']*|\([^()]*\))/g;
  for (const match of code.matchAll(plus)) {
    const operand = match[1] ?? "";
    if (!MONEY_WORDS.test(operand)) continue;
    uses.push({ key: `${file}: +${collapse(operand)}`, file, line: lineAt(code, match.index ?? 0) });
  }
  return uses;
}

/** Every UI source file scanned, repository-relative. */
export function uiFiles(): string[] {
  return UI_DIRS.flatMap((dir) => filesUnder(dir, (path) => /\.tsx?$/.test(path)));
}

/** Every `parseFloat(` in UI code, as `file:line`. */
export function parseFloatCalls(): string[] {
  return uiFiles().flatMap((file) => {
    const code = withoutComments(readRepoFile(file));
    return [...code.matchAll(/\bparseFloat\s*\(/g)].map((match) => `${file}:${lineAt(code, match.index ?? 0)}`);
  });
}

/** Every money-named `Number(…)` and unary `+` in UI code. */
export function floatUses(): FloatUse[] {
  return uiFiles().flatMap((file) => {
    const code = withoutComments(readRepoFile(file));
    return [...numberCalls(file, code), ...unaryPlus(file, code)];
  });
}
