import tseslint from "typescript-eslint";

/**
 * CLAUDE.md rule 2, enforced by tooling (ADR 0030, ADR 0031): company databases are reached only
 * through TenantConnectionService, with a TenantContext that TenantGuard made from the verified
 * session. Only core/tenancy and the tests may open a company database or decrypt its connection
 * string, and only TenantGuard (and tests) may build a TenantContext.
 */
const companyDatabaseImports = {
  paths: [
    {
      name: "@workspace/db",
      importNames: ["openCompanyDb", "decryptSecret"],
      message: "Reach company data through TenantConnectionService.db(tenant) (CLAUDE.md rule 2).",
    },
    {
      name: "postgres",
      message: "Database clients come from @workspace/db, company ones through TenantConnectionService.",
    },
    { name: "drizzle-orm/postgres-js", message: "Database clients come from @workspace/db (CLAUDE.md rule 2)." },
    { name: "@workspace/db/testing", message: "Test helpers never ship in the API." },
  ],
};

const tenantContextMessage =
  "Only TenantGuard (from the verified session) and the job runner build a TenantContext (CLAUDE.md rule 2).";

/** Every way to reach the factory: a property read, a computed read, destructuring, or an alias. */
const tenantContextFactory = [
  "MemberExpression[object.name='TenantContext'][property.name='fromVerifiedSession']",
  "MemberExpression[object.name='TenantContext'][property.name='forJob']",
  "MemberExpression[object.name='TenantContext'][computed=true]",
  "VariableDeclarator[init.name='TenantContext'] > ObjectPattern",
  "ImportSpecifier[imported.name='TenantContext'][local.name!='TenantContext']",
].map((selector) => ({ selector, message: tenantContextMessage }));

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", companyDatabaseImports],
      "no-restricted-syntax": ["error", ...tenantContextFactory],
    },
  },
  {
    files: ["src/core/tenancy/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/core/tenancy/tenant.guard.ts", "src/core/tenancy/tenant-context.ts", "src/core/jobs/job-tenants.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
