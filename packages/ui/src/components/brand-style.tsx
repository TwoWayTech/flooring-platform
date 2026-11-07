import { brandTokens, type AccentTokens } from "@workspace/shared";

function declarations(t: AccentTokens): string {
  return [
    `--brand:${t.accent}`,
    `--brand-foreground:${t.accentForeground}`,
    `--brand-ink:${t.accentInk}`,
    `--brand-soft:${t.accentSoft}`,
    `--pattern-1:${t.pattern[0]}`,
    `--pattern-2:${t.pattern[1]}`,
    `--pattern-3:${t.pattern[2]}`,
  ].join(";");
}

/**
 * Applies a company's brand color to the whole app: derives accessible accent tokens for both
 * themes from one color (design brief "Color") and overrides the CSS variables.
 */
export function BrandStyle({ color }: { color: string }) {
  const tokens = brandTokens(color);
  return <style>{`:root{${declarations(tokens.light)}}.dark{${declarations(tokens.dark)}}`}</style>;
}
