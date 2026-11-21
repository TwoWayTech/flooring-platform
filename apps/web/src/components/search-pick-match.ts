/** A labelled option of a search picker: the value it stands for and the text it shows. */
export type SearchOption<T extends string> = readonly [value: T, text: string];

/**
 * The options whose text contains what was typed, ignoring case and surrounding spaces. Names that
 * start with it come first, then names with a word that starts with it, then any other match, each
 * group in the given order, so Enter on the first row picks the likeliest one (finding #38).
 */
export function matchOptions<T extends string>(options: readonly SearchOption<T>[], typed: string): SearchOption<T>[] {
  const query = typed.trim().toLowerCase();
  if (!query) return [...options];
  const rank = (text: string): number => {
    const lower = text.toLowerCase();
    if (lower.startsWith(query)) return 0;
    if (lower.split(/\s+/).some((word) => word.startsWith(query))) return 1;
    return lower.includes(query) ? 2 : -1;
  };
  return options
    .map((option, index) => ({ option, index, rank: rank(option[1]) }))
    .filter((row) => row.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.option);
}
