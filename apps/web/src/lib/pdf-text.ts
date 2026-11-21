/**
 * The characters beyond Latin-1 that the PDFs' standard fonts (Helvetica, WinAnsi encoding) hold:
 * Windows-1252's 0x80 to 0x9F block, which includes × – — ‘ ’ “ ” • … and €.
 */
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Words or plain characters for signs the PDF font lacks, so the PDF never prints a wrong glyph. */
const REPLACEMENTS: Record<string, string> = {
  "≈": "about",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "≤": "<=",
  "≥": ">=",
  "→": "->",
  "←": "<-",
  "✓": "yes",
  "\t": " ",
  " ": " ",
  " ": " ",
  " ": " ",
};

/** Whether the standard PDF font can print the character. */
function printable(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || ch === "\n" || WIN_ANSI_EXTRAS.has(ch);
}

/**
 * Text as the PDF can print it (click-through #11). @react-pdf/renderer's standard fonts encode
 * WinAnsi only, and a character outside it comes out as a wrong glyph ("≈ 8 cartons" printed an H
 * over the 8). Known signs become words or plain characters ("about 8 cartons"); anything else the
 * font lacks becomes "?". The screen keeps the original text.
 */
export function pdfText(text: string): string {
  return Array.from(text, (ch) => (printable(ch) ? ch : (REPLACEMENTS[ch] ?? "?"))).join("");
}

/** Every string inside a PDF model passed through `pdfText`, keeping its shape. */
export function pdfSafe<T>(value: T): T {
  if (typeof value === "string") return pdfText(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => pdfSafe(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pdfSafe(v)])) as T;
  }
  return value;
}
