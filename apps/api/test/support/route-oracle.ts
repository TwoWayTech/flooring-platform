import {
  can,
  enabledModules,
  permissionsForModules,
  PRODUCT_MODULES,
  resolveAccess,
  roleTemplate,
  type DefaultRoleKey,
  type ProductKey,
} from "@workspace/shared";
import type { CatalogRoute } from "./route-catalog";

/** What the guard chain should answer: pass, or the refusal code it throws. */
export type GuardOutcome =
  "pass" | "product_not_enabled" | "permission_undeclared" | "module_not_enabled" | "forbidden";

/** The company and web host a request is made in, as the oracle needs them. */
export interface OracleCompany {
  /** The company's products. A newly provisioned trial with no subscription and no overrides. */
  products: readonly ProductKey[];
  /** The product the web host serves (the proxy's product header), if any. */
  host: ProductKey | undefined;
}

/**
 * What TenantGuard then PermissionGuard should decide for a person holding one default role, with
 * MFA held, in a fresh trial company (whole-product check, PM-2). Built only from packages/shared
 * (CLAUDE.md rule 4: the API guards and the screens use the same engine), and never from the API's
 * own `permissionDecision`, so the real guard chain is the defendant, not the judge. The order is
 * the chain's:
 * 1. a product the company lacks, from the host or `@RequireProduct` (TenantGuard; blueprint p17);
 * 2. no declared key and not any-member: deny by default (CLAUDE.md rule 3);
 * 3. a declared module that is off (checked only when the route declares one);
 * 4. none of the declared keys held, where effective = role ∩ ceiling ∩ enabled modules (rule 4);
 * 5. otherwise the guards let the request through.
 * The MFA and disabled-profile refusals are covered by mfa.int.test.ts and permissions.int.test.ts.
 */
export function expectedOutcome(route: CatalogRoute, role: DefaultRoleKey, company: OracleCompany): GuardOutcome {
  const needed = [company.host, route.product];
  if (needed.some((product) => product !== undefined && !company.products.includes(product))) {
    return "product_not_enabled";
  }
  if (route.anyOf.length === 0 && !route.anyMember) return "permission_undeclared";
  // A fresh trial has no plan (null) and no overrides; provisioning sets the ceiling to every
  // permission of its products' modules (packages/db company-foundation, `productPermissions`).
  const modules = enabledModules(company.products, null, []);
  if (route.module !== undefined && !modules.includes(route.module)) return "module_not_enabled";
  const template = roleTemplate(role);
  const ceiling = permissionsForModules(company.products.flatMap((product) => PRODUCT_MODULES[product]));
  const access = resolveAccess(
    [{ id: role, permissions: template.permissions, dataScope: template.dataScope, owner: template.owner }],
    ceiling,
    modules,
  );
  if (route.anyOf.length > 0 && !route.anyOf.some((key) => can(access, key))) return "forbidden";
  return "pass";
}
