/** A sentence end already there: ".", "!", "?" or "…", perhaps followed by closing quotes or a bracket. */
const ENDED = /[.!?…]["'”’)\]]*$/;

/**
 * Ends a sentence with a period unless it already ends with one, so a template that closes a
 * sentence with a name ("Access saved for Summit Floor Co.") never prints "Co.." (click-through
 * #42). Trailing spaces are dropped first.
 */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed === "") return trimmed;
  return ENDED.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The noun for a count: `one` for exactly 1, `many` otherwise, so a message never reads
 * "1 flagged sheets" (click-through #46). Irregular plurals are passed in whole.
 */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
