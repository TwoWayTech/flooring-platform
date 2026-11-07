/**
 * Brand color math (design brief "Color"): each company supplies one brand color; we derive
 * accessible accent tokens for both themes in OKLCH and block colors that cannot work.
 */

/** An OKLCH color: lightness 0..1, chroma, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** Whether a string is a 6-digit hex color. */
export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

function hexToRgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`Not a hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};

/** Converts a hex color to OKLCH (Björn Ottosson's OKLab). */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.sqrt(A * A + B * B), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Converts OKLCH to hex, reducing chroma until the color fits the sRGB gamut. */
export function oklchToHex(color: Oklch): string {
  let c = color.c;
  let rgb = oklchToLinear({ ...color, c });
  while (c > 0 && rgb.some((v) => v < -0.0001 || v > 1.0001)) {
    c = Math.max(0, c - 0.005);
    rgb = oklchToLinear({ ...color, c });
  }
  return `#${rgb.map((v) => fromLinear(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** WCAG relative luminance of a hex color. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Fixed neutrals from the design brief that accents must work against. */
export const NEUTRALS = {
  light: { background: "#EEF0EC", surface: "#FAFBF9", text: "#1F2B30" },
  dark: { background: "#152024", surface: "#1D2B31", text: "#E6EBE8" },
} as const;

/** Accent tokens for one theme. */
export interface AccentTokens {
  /** Solid fill for primary buttons and active marks. */
  accent: string;
  /** Text on the solid fill. */
  accentForeground: string;
  /** Accent used as text or icon on the surface (links, active nav). */
  accentInk: string;
  /** Faint tint for selected rows and the active nav item. */
  accentSoft: string;
}

/** Moves lightness in steps until the predicate passes; returns the closest passing color. */
function adjustUntil(start: Oklch, direction: 1 | -1, passes: (hex: string) => boolean): string {
  for (let l = start.l; l >= 0 && l <= 1; l += 0.01 * direction) {
    const hex = oklchToHex({ ...start, l });
    if (passes(hex)) return hex;
  }
  return direction === 1 ? "#FFFFFF" : "#000000";
}

/**
 * Derives accent tokens for both themes from one brand color. Light theme darkens the fill
 * until white text reaches 4.5:1; dark theme brightens it (as the brief's Patina #4FB3A3 does)
 * until dark text reaches 4.5:1.
 */
export function brandTokens(brandHex: string): { light: AccentTokens; dark: AccentTokens } {
  const base = hexToOklch(brandHex);
  const lightFill = adjustUntil(base, -1, (hex) => contrastRatio(hex, "#FFFFFF") >= 4.5);
  const lightInk = adjustUntil(base, -1, (hex) => contrastRatio(hex, NEUTRALS.light.background) >= 4.5);
  const darkStart = { ...base, l: Math.max(base.l, 0.7) };
  const darkFill = adjustUntil(darkStart, 1, (hex) => contrastRatio(hex, NEUTRALS.dark.background) >= 4.5);
  const darkInk = adjustUntil(darkStart, 1, (hex) => contrastRatio(hex, NEUTRALS.dark.surface) >= 4.5);
  return {
    light: {
      accent: lightFill,
      accentForeground: "#FFFFFF",
      accentInk: lightInk,
      accentSoft: oklchToHex({ l: 0.94, c: Math.min(base.c, 0.12) * 0.35, h: base.h }),
    },
    dark: {
      accent: darkFill,
      accentForeground: NEUTRALS.dark.background,
      accentInk: darkInk,
      accentSoft: oklchToHex({ l: 0.3, c: Math.min(base.c, 0.12) * 0.45, h: base.h }),
    },
  };
}

/** Result of checking a proposed brand color. */
export interface BrandCheck {
  ok: boolean;
  /** Contrast of the raw color against the light surface. */
  contrastOnSurface: number;
  message: string;
}

/**
 * Blocks brand colors that cannot serve as an accent: the raw color must reach the WCAG
 * non-text contrast of 3:1 against the light surface, or buttons and focus marks disappear.
 */
export function checkBrandColor(hex: string): BrandCheck {
  if (!isHexColor(hex))
    return { ok: false, contrastOnSurface: 0, message: "Enter a 6-digit hex color, for example #2E8B7E." };
  const ratio = contrastRatio(hex, NEUTRALS.light.surface);
  if (ratio < 3) {
    return {
      ok: false,
      contrastOnSurface: ratio,
      message: "This color is too light to read against panels. Pick a deeper shade.",
    };
  }
  return {
    ok: true,
    contrastOnSurface: ratio,
    message: "Passes WCAG AA. Buttons and text shades are adjusted automatically.",
  };
}
