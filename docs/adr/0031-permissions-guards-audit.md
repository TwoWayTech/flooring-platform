# ADR 0031: Permissions, sensitive fields and audit in the API (P10, part 1)

- **Status:** accepted, 2026-11-13
- **Context:** blueprint P10 (R4); CLAUDE.md rules 3, 4, 5 and 10; spec docs/product-spec/settings-and-permissions.md, rules 1 to 9 and 30. The owner's work queue asked for "permissions in the API reusing the engine in packages/shared, deny-by-default guards, the audit log and approvals". The owner was away and asked for the safest option on anything open.

## Decisions

### One pipeline, in a fixed order
`RequestPipelineModule` is the only place that registers global guards and interceptors:
1. SessionGuard;
2. TenantGuard (ADR 0030);
3. PermissionGuard;
4. around the handler, the SensitiveFieldsInterceptor (outer) and the AuditInterceptor (inner). Audit sits next to the handler, so a committed write is recorded before anything that could still fail, such as serialising the response (PR #7 re-review).

### Access comes from the shared engine
`AccessService.resolve(tenant)` builds a person's access with `resolveAccess` from packages/shared (rule 4):
- their roles and role permissions from the company database;
- the company ceiling (`tenant_permission_ceiling`, allowed rows) from the control database;
- the enabled modules from `enabledModules(products, planModules, overrides)` in packages/shared. That function takes the products' modules, limited to the plan's modules when there is a subscription (all of them during a trial), then applies `tenant_module_overrides`. Overrides never reach outside the products, and `platform` is always on.

Plan modules come from `planModulesOf` (packages/shared):
- null (a trial, all of the products' modules) only when the company is in `trial` status and has never had a subscription;
- a company that is not a trial and has no subscription rows gets no plan modules;
- otherwise the union of its current subscriptions' plans; a cancelled subscription, or a trial subscription past its period, is not current;
- when none is current, the latest plan, read-only through the tenant status.

So neither a cancelled plan nor deleted subscription rows turn a company back into a trial (PR #7 reviews).

Nothing is cached between requests, so a change to roles, the ceiling or modules applies at once. A person with no profile in the company, or a disabled profile, holds nothing.

### Deny by default
- Every company route must declare `@RequirePermission(...keys)` (any one of them, spec rule 5) or `@AnyCompanyMember()`. A route that declares neither is refused with 403 `permission_undeclared` and an error in the log, so a forgotten decorator fails closed.
- Class-level decorators are defaults for reads only (PR #7 review):
  - `@AnyCompanyMember()` counts only on a handler;
  - a write (POST, PUT, PATCH, DELETE) counts only permissions on its own handler;
  - `@Audited()` counts only on a handler, so a class-level one cannot silence the safety net.

  So a controller that lets members read can never let them write by accident.
- `@RequireModule()` adds a module check. A permission belongs to a module, so a route never serves a company whose products or plan lack it. This closes the P9 follow-up about routes that declared no product.
- The route-inventory test proves that every company route declares its permissions.

### Sensitive fields are stripped by the server
- `SENSITIVE_FIELDS` in packages/shared maps JSON property names to the key that reveals them:
  - product cost: `cost`, `unitCost`, `averageCost`, `landedCost`, `costPerSqFt`, `productCost`;
  - sales margin: `margin`, `marginPct`, `grossMargin`, `grossMarginPct`;
  - job costing: `jobMargin`, `jobMarginPct`, `jobCost`, `laborCost`;
  - pay: `payRate`, `hourlyRate`, `baseRate`, `regularRate`, `salary`, `salaryAmount`;
  - `creditLimit`;
  - contract line `estimatedCost`.
- A test fails when a new cost, margin, rate, wage or limit field in packages/shared is neither sensitive nor listed as not sensitive with a reason. Payroll amounts are not stripped by name: payroll routes need `hr.payroll.view`.
- Snake_case names from raw SQL (`unit_cost`) match too.
- The SensitiveFieldsInterceptor first turns the body into the JSON the client would receive, so class instances, `toJSON`, Dates and decimals are covered as sent. It then removes the fields at any depth from every company response for anyone without the key (rule 5).
- The error filter strips error `details` the same way.
- **These names are reserved:** a module must not use them for values that are not sensitive.
- **Job costing must use the job names** (`jobCost`, `jobMargin`, `jobMarginPct`), not `cost` and `margin`. Otherwise the sales-margin key would reveal job margins (PR #7 review).
- A handler that writes the response itself (`@Res()`) bypasses interceptors, so modules must not do that.
- **Exports:** files and streams pass unchanged, so an export strips its data with `stripSensitive` before building the file.

### The audit log is append-only and every write is audited
- Company migration 0001 adds a trigger that refuses UPDATE, DELETE and TRUNCATE on `audit_log` from any normal statement, the company login's included.
- This adds triggers to an existing table. CLAUDE.md says to ask before altering one, but the owner asked for the safest option without stops. The trigger changes no column and enforces the blueprint's own append-only rule, so it was added without asking and is recorded here.
- **Residual risk (PR #7 reviews):** the company login owns the table, so it could still `DISABLE TRIGGER` or `DROP TRIGGER`. The trigger stops application bugs, not stolen credentials or SQL injection. The fix is a runtime role that does not own the database (STATUS).
- `AuditService.record(tenant, actor, entry, tx?)` writes an entry. Modules pass their transaction, so the change and its entry commit together, and mark the handler `@Audited()`.
- The AuditInterceptor is the safety net. Every successful company write (POST, PUT, PATCH, DELETE) that is not `@Audited()` gets an entry before the response is sent: category `data`, the route, the target id, the actor and their role names. It copies no request body, so nothing sensitive lands in the log.
- If that entry fails, the error is logged loudly. The write is already committed, which is why modules write their own entries in their transactions. An alert on these errors comes with monitoring (STATUS).

### Separation of duties and data scope
- `separateDuties(recordedBy, actor)` in packages/shared refuses the person who recorded something as its approver. Payments, stock adjustments and other approvals use it when their modules are built.
- `scopeAllows(scope, viewer, row)` is the data-scope rule (spec rule 4). The API gives handlers `@CurrentAccess()` with `dataScope` and `branchId`, and modules apply the rule in their queries.

### New companies can work at once
Provisioning (ADR 0030) now writes:
- the products' default roles as system roles, limited to the products' permissions;
- the owner's profile with the Owner role;
- a ceiling of every permission in the products' modules.

### Rule 2 is enforced by lint
ESLint in apps/api enforces two things (P9 follow-ups):
- imports of `openCompanyDb`, `decryptSecret`, `postgres`, `drizzle-orm/postgres-js` and `@workspace/db/testing` are refused outside core/tenancy;
- reaching `TenantContext.fromVerifiedSession` outside TenantGuard is refused, whether by a property read, a computed read, destructuring or an aliased import.

Lint is a guard against mistakes, not a security boundary. The runtime checks in TenantGuard and TenantConnectionService are the boundary.

## Left for P10 part 2 (Settings → Users and Roles API)
- No-escalation on grants, the active-Owner rule, step-up MFA on role changes, and support-access grants. They are rules of the role and user endpoints, which do not exist yet. The shared engine already has `canGrant`, `canAssignRole`, `escalations` and `hasActiveOwner`, and part 2 calls them on the server.
- Step-up MFA is client-only in the demo (spec, "Edge cases"), so it needs its own server design.
- Keeping `member.role` in sync with role assignment, and deciding MFA from role content rather than key (STATUS).

## Rejected
- **Caching access between requests:** a revoked role would keep working until the cache expired.
- **Stripping sensitive fields per module:** one forgotten field leaks; a central list fails closed.
- **Audit only in modules:** a module that forgets breaks rule 10. The interceptor makes forgetting visible but safe.
- **A database role without UPDATE and DELETE on `audit_log`, now:** the company login owns its database, so it cannot be denied yet. The trigger stops every normal statement until a non-owner runtime role exists (STATUS).
