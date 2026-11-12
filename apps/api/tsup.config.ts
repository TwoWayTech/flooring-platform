import { defineConfig } from "tsup";

/**
 * Bundles the API into dist/main.js. Workspace packages are TypeScript source, so they are
 * bundled in; every npm package stays external, including those the workspace packages import,
 * and is installed in the image by `pnpm deploy`. SWC runs because the tsconfig emits decorator
 * metadata, which NestJS dependency injection needs (ADR 0028).
 */
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@workspace\//],
  external: [/^(?!@workspace\/)(@[a-z0-9-]+\/)?[a-z0-9][\w.-]*(\/.*)?$/],
});
