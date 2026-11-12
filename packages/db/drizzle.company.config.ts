import { defineConfig } from "drizzle-kit";

/** Migrations every company database runs; one schema for all companies, HR-only included (blueprint p17). */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/company/index.ts",
  out: "./migrations/company",
  casing: "snake_case",
});
