import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@workspace/shared/fixtures/*"],
              message: "Screens read data only through apiClient. Fixtures are loaded by DemoStore.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/api/demo/**"],
    rules: { "no-restricted-imports": "off" },
  },
]);
