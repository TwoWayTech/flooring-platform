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
  ],
};

const tenantContextFactory = {
  selector: "MemberExpression[object.name='TenantContext'][property.name='fromVerifiedSession']",
  message: "Only TenantGuard builds a TenantContext, from the verified session (CLAUDE.md rule 2).",
};

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", companyDatabaseImports],
      "no-restricted-syntax": ["error", tenantContextFactory],
    },
  },
  {
    files: ["src/core/tenancy/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/core/tenancy/tenant.guard.ts", "src/core/tenancy/tenant-context.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
