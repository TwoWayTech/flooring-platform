import { defineConfig } from "vitest/config";

/** Unit tests run anywhere; integration tests need the local PostgreSQL (docker compose up -d). */
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["test/**/*.test.ts"], exclude: ["test/**/*.int.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["test/**/*.int.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
    passWithNoTests: true,
  },
});
