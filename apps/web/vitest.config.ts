import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for web code that has no screen (the API client router and transport), and for the
 * pure parts of screens such as table columns. tsconfig keeps JSX for Next.js ("preserve"), so the
 * tests compile it themselves with the automatic runtime.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/unit/**/*.test.{ts,tsx}"] },
});
