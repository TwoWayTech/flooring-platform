# ADR 0031: Permissions, sensitive fields and audit in the API (P10, part 1)

- **Status:** accepted, 2026-11-13
- **Context:** blueprint P10 (R4); CLAUDE.md rules 3, 4, 5 and 10; spec docs/product-spec/settings-and-permissions.md, rules 1 to 9 and 30. The owner's work queue asked for "permissions in the API reusing the engine in packages/shared, deny-by-default guards, the audit log and approvals". The owner was away and asked for the safest option on anything open.

## Decisions

### One pipeline, in a fixed order
`RequestPipelineModule` is the only place that registers global guards and interceptors:
1. SessionGuard;
2. TenantGuard (ADR 0030);
3. PermissionGuard;
4. around the handler, the AuditInterceptor (outer) and the SensitiveFieldsInterceptor (inner).

### Access comes from the shared engine
`AccessService.resolve(tenant)` builds a person's access with `resolveAccess` from packages/shared (rule 4):
- their roles and role permissions from the company database;
- the company ceiling (`tenant_permission_ceiling`, allowed rows) from the control database;
- the enabled modules from `enabledModules(products, planModules, overrides)` in packages/shared. That function takes the products' modules, limited to the plan's modules when there is a subscription (all of them during a trial), then applies `tenant_module_overrides`. Overrides never reach outside the products, and `platform` is always on.

Nothing is cached between requests, so a change to roles, the ceiling or modules applies at once. A person with no profile in the company, or a disabled profile, holds nothing.

### Deny by default
- Every company route must declare `@RequirePermission(...keys)` (any one of them, spec rule 5) or `@AnyCompanyMember()`. A route that declares neither is refused with 403 `permission_undeclared` and an error in the log, so a forgotten decorator fails closed.
- `@RequireModule()` adds a module check. A permission belongs to a module, so a route never serves a company whose products or plan lack it. This closes the P9 follow-up about routes that declared no product.
- The route-inventory test proves that every company route declares its permissions.

### Sensitive fields are stripped by the server
- `SENSITIVE_FIELDS` in packages/shared maps JSON property names to the key that reveals them:
  - `cost`, `unitCost`, `averageCost`, `landedCost` → product cost;
  - `margin`, `marginPct`, `grossMargin` → margin;
  - `jobMargin`;
  - `payRate`, `hourlyRate`, `salary`;
  - `creditLimit`;
  - `estimatedCost`.
- The SensitiveFieldsInterceptor removes them, at any depth, from every company response for anyone without the key (rule 5).
- **These names are reserved:** a module must not use them for values that are not sensitive.
- A handler that writes the response itself (`@Res()`) bypasses interceptors, so modules must not do that.

### The audit log is append-only and every write is audited
- Company migration 0001 adds a trigger that refuses UPDATE, DELETE and TRUNCATE on `audit_log`, even for the company login that owns the database (a GRANT cannot stop an owner).
- `AuditService.record(tenant, actor, entry, tx?)` writes an entry. Modules pass their transaction, so the change and its entry commit together, and mark the handler `@Audited()`.
- The AuditInterceptor is the safety net. Every successful company write (POST, PUT, PATCH, DELETE) that is not `@Audited()` gets an entry before the response is sent: category `data`, the route, the target id, the actor and their role names. It copies no request body, so nothing sensitive lands in the log.
- If that entry fails, the error is logged loudly. The write is already committed, which is why modules write their own entries in their transactions.

### Separation of duties and data scope
- `separateDuties(recordedBy, actor)` in packages/shared refuses the person who recorded something as its approver. Payments, stock adjustments and other approvals use it when their modules are built.
- `scopeAllows(scope, viewer, row)` is the data-scope rule (spec rule 4). The API gives handlers `@CurrentAccess()` with `dataScope` and `branchId`, and modules apply the rule in their queries.

### New companies can work at once
Provisioning (ADR 0030) now writes:
- the products' default roles as system roles, limited to the products' permissions;
- the owner's profile with the Owner role;
- a ceiling of every permission in the products' modules.

### Rule 2 is enforced by lint
ESLint in apps/api refuses imports of `openCompanyDb` and `decryptSecret` outside core/tenancy, and refuses calls to `TenantContext.fromVerifiedSession` outside TenantGuard (P9 follow-ups).

## Left for P10 part 2 (Settings → Users and Roles API)
- No-escalation on grants, the active-Owner rule, step-up MFA on role changes, and support-access grants. They are rules of the role and user endpoints, which do not exist yet. The shared engine already has `canGrant`, `canAssignRole`, `escalations` and `hasActiveOwner`, and part 2 calls them on the server.
- Step-up MFA is client-only in the demo (spec, "Edge cases"), so it needs its own server design.
- Keeping `member.role` in sync with role assignment, and deciding MFA from role content rather than key (STATUS).

## Rejected
- **Caching access between requests:** a revoked role would keep working until the cache expired.
- **Stripping sensitive fields per module:** one forgotten field leaks; a central list fails closed.
- **Audit only in modules:** a module that forgets breaks rule 10. The interceptor makes forgetting visible but safe.
- **A database role without UPDATE and DELETE on `audit_log`:** the company login owns its database, so it cannot be denied. The trigger works for every login.
