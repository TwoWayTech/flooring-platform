import type { ProductKey } from "@workspace/shared";
import { readRepoFile } from "./source";

/**
 * The route catalog the API's route matrix writes (apps/api/test/__snapshots__, whole-product check,
 * ADR 0058): the source of truth for routes, their keys, modules and switches, and for which
 * default role gets past the guards. The web's coverage list and page gates read these committed
 * snapshots, never the API source, so they need no server and agree with the reviewed matrix.
 */

/** One route's guard requirements, as `route-requirements.json` holds them. */
export interface RouteRequirement {
  level: "public" | "session" | "company";
  product: string | null;
  module: string | null;
  anyOf: string[];
  anyMember: boolean;
  audited: boolean;
  sensitiveKeys: string[] | null;
  /** Feature switch → its effect on the route ("gating", "shaping", "any-of"), or null off company routes. */
  features: Record<string, string> | null;
}

const REQUIREMENTS = "apps/api/test/__snapshots__/route-requirements.json";
const ROLE_MATRIX = "apps/api/test/__snapshots__/route-role-matrix.txt";

/** Every route of the catalog by its `VERB /path` name. */
export function routeRequirements(): Map<string, RouteRequirement> {
  const parsed = JSON.parse(readRepoFile(REQUIREMENTS)) as { routes: Record<string, RouteRequirement> };
  return new Map(Object.entries(parsed.routes).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Which default roles of each product get past TenantGuard and PermissionGuard on each company
 * route in a fresh trial (MFA held), from `route-role-matrix.txt`. A product with `-` lets none in.
 */
export function routeRoles(): Map<string, Record<ProductKey, Set<string>>> {
  const lines = readRepoFile(ROLE_MATRIX)
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const roles = new Map<string, Record<ProductKey, Set<string>>>();
  for (const line of lines) {
    const match = /^(\S+ \S+) {2}flooring: (.*?) {2}hr: (.*)$/.exec(line);
    if (!match) throw new Error(`Unreadable line in ${ROLE_MATRIX}: ${line}`);
    const names = (list: string) => new Set(list === "-" ? [] : list.split(" "));
    roles.set(match[1] ?? "", { flooring: names(match[2] ?? ""), hr: names(match[3] ?? "") });
  }
  return roles;
}
