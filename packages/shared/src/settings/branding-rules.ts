import { checkBrandColor } from "../color";
import type { Branding, FloorPattern } from "../types/company";

/** The longest display name Branding takes (ADR 0059, part 6, D4): the shell's top bar and documents print it. */
export const BRANDING_NAME_MAX = 80;

/** The largest logo the demo keeps, in bytes (spec rule 27): logos live in the browser's demo storage there. */
export const LOGO_MAX_BYTES = 300_000;

/** The floor patterns a company picks from, in the order Settings → Branding lists them. */
export const FLOOR_PATTERNS = ["herringbone", "running-bond", "basketweave"] as const satisfies readonly FloorPattern[];

/** The default themes a company picks from. */
export const DEFAULT_THEMES = ["system", "light", "dark"] as const satisfies readonly Branding["defaultTheme"][];

/** A brand color as stored: `#` and six hex digits, nothing around them (spec rule 27). */
export const BRAND_COLOR_TEXT = /^#[0-9A-Fa-f]{6}$/;

/** A monogram: one or two capital letters or digits, as the page types them (spec rule 27). */
export const MONOGRAM_TEXT = /^[A-Z0-9]{1,2}$/;

/**
 * Line breaks and other control characters, refused in the display name: it is printed in email
 * subjects and on documents, where a line break would split a header or a line (ADR 0059, part 6, D4).
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/** A logo as the demo keeps it: a base64 PNG, SVG or JPEG data URL (spec rule 27). */
const LOGO_DATA_URL = /^data:image\/(png|svg\+xml|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/** The longest base64 text a logo of `LOGO_MAX_BYTES` takes: four characters per three bytes. */
const LOGO_BASE64_MAX = Math.ceil(LOGO_MAX_BYTES / 3) * 4;

/** What Branding says about each field it refuses, the same words in both modes (ADR 0059, part 6, D4). */
export const BRANDING_MESSAGES = {
  displayName: `Enter a display name of up to ${BRANDING_NAME_MAX} characters, on one line.`,
  monogram: "Use 1 or 2 capital letters or digits for the monogram, such as SF.",
  /** `checkBrandColor`'s own words for a value that is not a hex color. */
  brandColor: checkBrandColor("").message,
  pattern: "Choose a floor pattern.",
  defaultTheme: "Choose a default theme: light, dark or the device's own setting.",
  logo: "Use a PNG, SVG or JPEG logo of up to 300 KB.",
  /** The API keeps no logo yet (ADR 0059, part 6, D5): the monogram stands in. */
  logoNotOnApi: "Logos can't be uploaded yet. The monogram stands in for a logo.",
} as const;

/** Whether a logo is none, or a data URL the demo may keep (PNG, SVG or JPEG, at most `LOGO_MAX_BYTES`). */
function logoOk(logo: string | null): boolean {
  if (logo === null) return true;
  const match = LOGO_DATA_URL.exec(logo);
  return match !== null && match[2]!.length <= LOGO_BASE64_MAX;
}

/**
 * Why branding can't be saved, or null (spec rule 27; ADR 0059, part 6, D4). The display name is
 * checked trimmed and measured as stored; the brand color must be `#` and six hex digits and pass
 * `checkBrandColor`'s contrast check, with its words; the pattern and theme are their options; the
 * logo is none or a small image data URL (the API takes none, D5). DemoStore and the API run it, and
 * the page runs it before it asks for a step-up code, so a refused value never costs one.
 */
export function brandingProblem(branding: Branding): string | null {
  const name = branding.displayName;
  if (name.trim() === "" || name.length > BRANDING_NAME_MAX || CONTROL_CHARACTERS.test(name))
    return BRANDING_MESSAGES.displayName;
  if (!MONOGRAM_TEXT.test(branding.monogram)) return BRANDING_MESSAGES.monogram;
  if (!BRAND_COLOR_TEXT.test(branding.brandColor)) return BRANDING_MESSAGES.brandColor;
  const contrast = checkBrandColor(branding.brandColor);
  if (!contrast.ok) return contrast.message;
  if (!(FLOOR_PATTERNS as readonly string[]).includes(branding.pattern)) return BRANDING_MESSAGES.pattern;
  if (!(DEFAULT_THEMES as readonly string[]).includes(branding.defaultTheme)) return BRANDING_MESSAGES.defaultTheme;
  if (!logoOk(branding.logoDataUrl)) return BRANDING_MESSAGES.logo;
  return null;
}
