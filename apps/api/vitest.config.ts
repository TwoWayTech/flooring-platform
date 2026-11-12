import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/** SWC compiles the tests so NestJS decorator metadata exists, as in the build (ADR 0028). */
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/**/*.test.ts"], exclude: ["test/**/*.int.test.ts"] },
      },
      {
        extends: true,
        test: { name: "integration", include: ["test/**/*.int.test.ts"], testTimeout: 30_000 },
      },
    ],
    passWithNoTests: true,
  },
});
