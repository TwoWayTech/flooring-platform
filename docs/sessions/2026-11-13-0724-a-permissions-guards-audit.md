# 2026-11-13, Person A: P10 permissions, guards and audit (part 1)

## Goal
Owner's work queue, task 2: "Blueprint P10 (R4): permissions in the API reusing the engine in packages/shared, deny-by-default guards, the audit log and approvals." The owner is away, so there are no stops for questions. The safest option goes in docs/blueprint-delta.md.

## Prompt used
The owner's work queue, 2026-11-13, task 2, and the blueprint P10 prompt (p46):

> Move the packages/shared permission rules into API guards: @RequireProduct, @RequireModule, @RequirePermission, data scope, sensitive-field serializer, ceiling, no-escalation on grants, step-up MFA on role changes, support-access grants, separation-of-duties rules, append-only audit interceptor. security-reviewer subagent reviews it. Matrix test of every default role against every permission.

Spec: docs/product-spec/settings-and-permissions.md, business rules 1–9 and 30, and the AuditEntry entity.

## Scope decision
P10 splits in two:
- **Part 1, this branch:** what every endpoint needs: access, guards, scope, sensitive fields, audit and the separation-of-duties rule.
- **Part 2, with the Settings → Users and Roles API:** the role and user endpoints themselves. No-escalation on grants, step-up MFA on role changes and support-access grants are rules of those endpoints. The shared engine already has `canGrant`, `canAssignRole`, `escalations` and `hasActiveOwner` for them. Step-up MFA also needs a server-side design, because today it is client-only (spec, "Edge cases").

This is recorded in the blueprint delta.

## Plan (part 1)
1. **packages/shared:**
   - `enabledModules(products, planModules, overrides)`: the product's modules, limited to the plan's (or all of the product's while there is no subscription), then changed by overrides. `platform` is always on.
   - `SENSITIVE_FIELDS`: JSON property name to the key that reveals it.
   - `scopeAllows(scope, viewer, row)`.
   - `assertSeparateDuties(recordedBy, actor)`: separation of duties.
   - Unit tests for each.
2. **packages/db:**
   - A company migration that makes `audit_log` append-only with a trigger refusing UPDATE and DELETE (plain PostgreSQL).
   - `provisionTenant` writes the product's default roles, the owner's profile and role, a ceiling of every permission in the product's modules, and module overrides that enable those modules while there is no subscription.
   - Tests.
3. **apps/api, core/access:**
   - `AccessService.resolve(tenant)`: role permissions from the company database ∩ ceiling ∩ enabled modules, through `resolveAccess` in packages/shared. Also the data scope and the user's branch. Cached per request.
   - A global `PermissionGuard` after TenantGuard. Every company route must declare `@RequirePermission(...keys)` (any of) or `@AnyCompanyMember()`. An undeclared route is refused with 403 `permission_undeclared`. That is deny by default, and it also closes the "routes that declare no product" follow-up, because permissions belong to modules and modules to products.
   - `@RequireModule()`.
   - `@CurrentAccess()`.
   - A global `SensitiveFieldsInterceptor` that strips `SENSITIVE_FIELDS` from company-route responses without the revealing key.
   - `AuditService.record()` and a global `AuditInterceptor` that writes an entry for every successful company write. A handler that writes its own entry is marked `@Audited()`.
4. **P9 follow-ups:**
   - `no-restricted-imports` in apps/api for `openCompanyDb` and `decryptSecret` outside core/tenancy and tests;
   - `TenantContext.fromVerifiedSession` gated by a module-private token held by TenantGuard.
5. **Tests:**
   - Unit tests for the shared rules, the interceptor and the guard decision.
   - Integration tests:
     - the role-by-permission matrix: every default role of each product, resolved from a provisioned company database, against the expected set;
     - the guards, through the probe: permission refused, module off, undeclared route;
     - sensitive fields stripped;
     - audit rows written and append-only;
     - the route inventory: every company route declares a permission.
6. **Docs:** ADR 0031, the API contract, the data model (audit trigger), the blueprint delta, STATUS and BRANCHES.
