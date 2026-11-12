import { defineConfig } from "drizzle-kit";

/** Migrations for the one control database (blueprint "Multi-tenancy and database schema"). */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/control/index.ts",
  out: "./migrations/control",
  casing: "snake_case",
});
