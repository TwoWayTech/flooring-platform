import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** CLAUDE.md rule 1: screens never import fixtures; only DemoStore (src/lib/api/demo) loads them. */
const fixtureImports = {
  group: ["@workspace/shared/fixtures/*"],
  message: "Screens read data only through apiClient. Fixtures are loaded by DemoStore.",
};

/**
 * The database package's test helpers and seed data never ship in the web app, as apps/api's
 * config already says for `@workspace/db/testing` (ADR 0054). Only src/** gets this rule, so the
 * e2e specs and their global setup under tests/ may still use them.
 */
const testOnlyDbImports = [
  { name: "@workspace/db/testing", message: "Test helpers never ship in the web app; only tests/ may use them." },
  { name: "@workspace/db/seed", message: "Seed data never ships in the web app; only tests/ may use it." },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "Use formatNumber or <Num> instead of toFixed in UI code.",
        },
      ],
      "no-restricted-imports": ["error", { patterns: [fixtureImports] }],
    },
  },
  {
    // Flat config replaces a rule's options, so the fixture pattern repeats here.
    files: ["src/**"],
    rules: { "no-restricted-imports": ["error", { paths: testOnlyDbImports, patterns: [fixtureImports] }] },
  },
  {
    // DemoStore may load fixtures, but never the database package's test helpers or seed data.
    files: ["src/lib/api/demo/**"],
    rules: { "no-restricted-imports": ["error", { paths: testOnlyDbImports }] },
  },
]);
