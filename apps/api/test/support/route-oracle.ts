import {
  can,
  enabledModules,
  permissionsForModules,
  PRODUCT_MODULES,
  resolveAccess,
  roleTemplate,
  type Access,
  type DefaultRoleKey,
  type ModuleKey,
  type PermissionKey,
  type ProductKey,
  type RoleLike,
} from "@workspace/shared";
import type { CatalogRoute } from "./route-catalog";

/** What the guard chain should answer: pass, or the refusal code it throws. */
export type GuardOutcome =
  "pass" | "product_not_enabled" | "permission_undeclared" | "module_not_enabled" | "forbidden";

/**
 * A seeded company's own access setup, where it is not a fresh trial: its plan's modules, its
 * permission ceiling and its roles, as its fixtures in packages/shared describe them.
 */
export interface SeededAccess {
  planModules: readonly ModuleKey[];
  ceiling: readonly PermissionKey[];
  roles: ReadonlyMap<DefaultRoleKey, RoleLike>;
}

/** The company and web host a request is made in, as the oracle needs them. */
export interface OracleCompany {
  /** The company's products. Without `seeded`, a newly provisioned trial with no subscription and no overrides. */
  products: readonly ProductKey[];
  /** The product the web host serves (the proxy's product header), if any. */
  host: ProductKey | undefined;
  /** A seeded company's plan, ceiling and roles (Summit Floor Co.), instead of a fresh trial's. */
  seeded?: SeededAccess;
}

/**
 * The modules switched on for the company (blueprint "Four layers of control", layer 2): a fresh
 * trial has no plan (null), so all of its products' modules; a seeded company has its plan's.
 */
function companyModules(company: OracleCompany): ModuleKey[] {
  return enabledModules(company.products, company.seeded?.planModules ?? null, []);
}

/**
 * The access one person holding one default role has in the company, by the shared engine
 * (CLAUDE.md rule 4: effective = role ∩ ceiling ∩ enabled modules). A fresh trial's ceiling is
 * every permission of its products' modules, as provisioning sets it (packages/db company-foundation,
 * `productPermissions`), and its roles are the shipped templates; a seeded company's are its own.
 */
export function accessFor(role: DefaultRoleKey, company: OracleCompany): Access {
  const template = roleTemplate(role);
  const held = company.seeded?.roles.get(role) ?? {
    id: role,
    permissions: template.permissions,
    dataScope: template.dataScope,
    owner: template.owner,
  };
  const ceiling =
    company.seeded?.ceiling ?? permissionsForModules(company.products.flatMap((product) => PRODUCT_MODULES[product]));
  return resolveAccess([held], ceiling, companyModules(company));
}

/**
 * What TenantGuard then PermissionGuard should decide for a person holding one default role, with
 * MFA held (whole-product check, PM-2, and PM-6 and PM-7 on Summit). Built only from
 * packages/shared (CLAUDE.md rule 4: the API guards and the screens use the same engine), and
 * never from the API's own `permissionDecision`, so the real guard chain is the defendant, not the
 * judge. The order is the chain's:
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
  if (route.module !== undefined && !companyModules(company).includes(route.module)) return "module_not_enabled";
  const access = accessFor(role, company);
  if (route.anyOf.length > 0 && !route.anyOf.some((key) => can(access, key))) return "forbidden";
  return "pass";
}
