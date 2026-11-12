import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for web code that has no screen (the API client router and transport). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
