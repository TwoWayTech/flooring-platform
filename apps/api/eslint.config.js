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
  patterns: [
    {
      group: ["**/jobs/job-tenants"],
      message: "Only job handlers get a company context from a job (ADR 0032); requests use TenantGuard's.",
    },
  ],
};

/** The same rules, with job handlers allowed to use JobTenants. */
const jobHandlerImports = { paths: companyDatabaseImports.paths };

/**
 * The platform console names a company by its id, for control-database rows only (ADR 0052;
 * docs/api-contract.md, Tenancy). So on top of the rules above, nothing in modules/platform may
 * import the way to a company database or its schema, even for types.
 */
const platformImports = {
  paths: [
    ...companyDatabaseImports.paths,
    {
      name: "@workspace/db/company",
      message: "The platform console reads only the control database (ADR 0052).",
    },
  ],
  patterns: [
    ...companyDatabaseImports.patterns,
    {
      group: ["**/tenancy/tenant-connection.service", "**/tenancy/tenant-context"],
      message: "A platform route names a company for control rows only, never for its database (ADR 0052).",
    },
  ],
};

/**
 * The company side of platform admin, part 4 (ADR 0054): `GET /billing` reads control rows only,
 * so on top of the rules above nothing in modules/billing may import the company schema or
 * TenantConnectionService. Flat config replaces a rule's options, so the earlier paths repeat.
 */
const billingImports = {
  paths: [
    ...companyDatabaseImports.paths,
    { name: "@workspace/db/company", message: "Billing reads the control database only (ADR 0054)." },
  ],
  patterns: [
    ...companyDatabaseImports.patterns,
    {
      group: ["**/tenancy/tenant-connection.service"],
      message: "Billing reads the control database only (ADR 0054).",
    },
  ],
};

/**
 * The session-only `GET /company/standing` and its guard answer before any TenantContext exists and
 * must never make or use one (ADR 0054): the billing rules plus no TenantContext at all.
 */
const standingImports = {
  paths: billingImports.paths,
  patterns: [
    ...billingImports.patterns,
    {
      group: ["**/tenancy/tenant-context"],
      message: "The standing route never sees a TenantContext (ADR 0054).",
    },
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
    // The invitation service activates a profile from the invitation row, through JobTenants' checks.
    files: [
      "src/core/jobs/**/*.ts",
      "src/core/notifications/notification.service.ts",
      "src/modules/users/invitations.service.ts",
      "src/modules/finance/recurring-expenses.job.ts",
    ],
    rules: { "no-restricted-imports": ["error", jobHandlerImports] },
  },
  {
    files: ["src/modules/platform/**/*.ts"],
    rules: { "no-restricted-imports": ["error", platformImports] },
  },
  {
    files: ["src/modules/billing/**/*.ts"],
    rules: { "no-restricted-imports": ["error", billingImports] },
  },
  {
    // After the billing block, so the standing files get the stricter options.
    files: ["src/modules/billing/company-standing.*.ts"],
    rules: { "no-restricted-imports": ["error", standingImports] },
  },
  {
    files: ["src/core/tenancy/tenant.guard.ts", "src/core/tenancy/tenant-context.ts", "src/core/jobs/job-tenants.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
