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
        // Setting up and dropping throwaway databases can outlast the 10 s default when the files run in
        // parallel (DROP DATABASE ... WITH (FORCE) waits for other sessions to end).
        test: { name: "integration", include: ["test/**/*.int.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
      },
    ],
    passWithNoTests: true,
  },
});
