import { describe, expect, it } from "vitest";
import {
  BRANDING_MESSAGES,
  BRANDING_NAME_MAX,
  brandingProblem,
  checkBrandColor,
  LOGO_MAX_BYTES,
  SENSITIVE_FIELDS,
  settingsSectionProblem,
  type Branding,
} from "../src";

/**
 * Branding's shared rules (spec settings-and-permissions.md rule 27; ADR 0059, part 6, D4): the
 * words DemoStore, the API and the page show. Every case names its id first, for the mutation runs.
 */

const SUMMIT: Branding = {
  displayName: "Summit Floor Co.",
  monogram: "SF",
  brandColor: "#2E8B7E",
  pattern: "herringbone",
  logoDataUrl: null,
  defaultTheme: "system",
};

/** A base64 data URL of `bytes` bytes of an image type. */
function logoOf(type: string, bytes: number): string {
  return `data:image/${type};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;
}

describe("branding rules (ADR 0059, part 6)", () => {
  it("BR1 Summit's seeded branding passes, and so does each option of pattern and theme", () => {
    expect(brandingProblem(SUMMIT)).toBeNull();
    for (const pattern of ["herringbone", "running-bond", "basketweave"] as const)
      expect(brandingProblem({ ...SUMMIT, pattern }), pattern).toBeNull();
    for (const defaultTheme of ["system", "light", "dark"] as const)
      expect(brandingProblem({ ...SUMMIT, defaultTheme }), defaultTheme).toBeNull();
  });

  it("BR2 the display name: not blank, at most 80 characters as stored, on one line", () => {
    expect(BRANDING_NAME_MAX).toBe(80);
    expect(brandingProblem({ ...SUMMIT, displayName: "x".repeat(80) })).toBeNull();
    for (const displayName of [
      "",
      "   ",
      "x".repeat(81),
      ` ${"x".repeat(79)} `,
      "Summit\nBcc: a@b.c",
      "A\rB",
      "A\tB",
      "A B",
      "A\u0085B",
    ])
      expect(brandingProblem({ ...SUMMIT, displayName }), JSON.stringify(displayName)).toBe(
        BRANDING_MESSAGES.displayName,
      );
  });

  it("BR3 the monogram: one or two capital letters or digits", () => {
    for (const monogram of ["S", "SF", "S1", "42"])
      expect(brandingProblem({ ...SUMMIT, monogram }), monogram).toBeNull();
    for (const monogram of ["", "sf", "SFC", "S ", " S", "S-", "É"])
      expect(brandingProblem({ ...SUMMIT, monogram }), monogram).toBe(BRANDING_MESSAGES.monogram);
  });

  it("BR4 the brand color: # and six hex digits exactly, then the contrast check with its own words", () => {
    expect(brandingProblem({ ...SUMMIT, brandColor: "#2e8b7e" })).toBeNull();
    expect(BRANDING_MESSAGES.brandColor).toBe("Enter a 6-digit hex color, for example #2E8B7E.");
    for (const brandColor of ["2E8B7E", " #2E8B7E", "#2E8B7E ", "#2E8B7", "#2E8B7EE", "#GGGGGG", "red", ""])
      expect(brandingProblem({ ...SUMMIT, brandColor }), brandColor).toBe(BRANDING_MESSAGES.brandColor);
    const light = "#F5F0A0";
    expect(checkBrandColor(light).ok).toBe(false);
    expect(brandingProblem({ ...SUMMIT, brandColor: light })).toBe(
      "This color is too light to read against panels. Pick a deeper shade.",
    );
  });

  it("BR5 pattern and default theme: only their options", () => {
    const odd = (patch: object) => ({ ...SUMMIT, ...patch }) as Branding;
    expect(brandingProblem(odd({ pattern: "chevron" }))).toBe(BRANDING_MESSAGES.pattern);
    expect(brandingProblem(odd({ defaultTheme: "sepia" }))).toBe(BRANDING_MESSAGES.defaultTheme);
  });

  it("BR6 the logo: none, or a PNG, SVG or JPEG base64 data URL of at most 300 KB", () => {
    expect(LOGO_MAX_BYTES).toBe(300_000);
    for (const type of ["png", "svg+xml", "jpeg"])
      expect(brandingProblem({ ...SUMMIT, logoDataUrl: logoOf(type, LOGO_MAX_BYTES) }), type).toBeNull();
    const refused = [
      logoOf("png", LOGO_MAX_BYTES + 3),
      logoOf("gif", 10),
      logoOf("png", 10).replace(";base64", ""),
      "https://example.com/logo.png",
      "javascript:alert(1)",
      `${logoOf("png", 10)}"><script>`,
      "",
    ];
    for (const logoDataUrl of refused)
      expect(brandingProblem({ ...SUMMIT, logoDataUrl }), logoDataUrl.slice(0, 40)).toBe(BRANDING_MESSAGES.logo);
  });

  it("BR7 the dispatcher runs the rule for branding, and no branding field is a sensitive name", () => {
    expect(settingsSectionProblem("branding", SUMMIT, SUMMIT)).toBeNull();
    expect(settingsSectionProblem("branding", { ...SUMMIT, monogram: "sfc" }, SUMMIT)).toBe(BRANDING_MESSAGES.monogram);
    expect(Object.keys(SUMMIT).filter((key) => key in SENSITIVE_FIELDS)).toEqual([]);
  });

  it("BR8 the rule's order: name, monogram, color, pattern, theme, logo", () => {
    const all = {
      displayName: "",
      monogram: "",
      brandColor: "",
      pattern: "x",
      defaultTheme: "x",
      logoDataUrl: "x",
    } as unknown as Branding;
    expect(brandingProblem(all)).toBe(BRANDING_MESSAGES.displayName);
    expect(brandingProblem({ ...all, displayName: "A" })).toBe(BRANDING_MESSAGES.monogram);
    expect(brandingProblem({ ...all, displayName: "A", monogram: "A" })).toBe(BRANDING_MESSAGES.brandColor);
    const colored = { ...all, displayName: "A", monogram: "A", brandColor: "#2E8B7E" };
    expect(brandingProblem(colored)).toBe(BRANDING_MESSAGES.pattern);
    expect(brandingProblem({ ...colored, pattern: "basketweave" })).toBe(BRANDING_MESSAGES.defaultTheme);
    expect(brandingProblem({ ...colored, pattern: "basketweave", defaultTheme: "dark" })).toBe(BRANDING_MESSAGES.logo);
  });
});
