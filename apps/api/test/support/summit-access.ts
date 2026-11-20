import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  isDefaultRoleKey,
  PRODUCT_ROLES,
  type CompanyFixtures,
  type DefaultRoleKey,
  type PlatformFixtures,
  type RoleLike,
} from "@workspace/shared";
import type { OracleCompany } from "./route-oracle";

/** One of packages/shared's demo fixtures (the data the seed writes), read as it is on disk. */
function sharedFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve(`@workspace/shared/fixtures/${name}.json`), "utf8"),
  ) as T;
}

/** Summit Floor Co. as packages/shared describes it: its platform record and its company fixtures. */
function summitFixtures(): { company: PlatformFixtures["companies"][number]; fixtures: CompanyFixtures } {
  const company = sharedFixture<PlatformFixtures>("platform").companies.find((candidate) => candidate.id === "summit");
  if (!company) throw new Error("No Summit Floor Co. in the platform fixtures.");
  return { company, fixtures: sharedFixture<CompanyFixtures>("summit") };
}

/**
 * Summit Floor Co. as the route oracle needs it, from the fixtures the seed writes and nothing the
 * API computes (S-4): Flooring Suite on its host, its plan's modules, its permission ceiling and
 * its own nine roles.
 */
export function summitOracleCompany(): OracleCompany {
  const { company, fixtures } = summitFixtures();
  const roles = new Map<DefaultRoleKey, RoleLike>();
  for (const role of fixtures.roles) {
    if (!isDefaultRoleKey(role.key)) continue;
    roles.set(role.key, { id: role.id, permissions: role.permissions, dataScope: role.dataScope, owner: role.owner });
  }
  return {
    products: [company.product],
    host: company.product,
    seeded: { planModules: company.modules, ceiling: company.ceiling, roles },
  };
}

/**
 * One seeded Summit person per default Flooring Suite role (the whole-product check's Summit
 * sweep): for each role, the first active user holding it, by fixture id. That gives Dana (Owner),
 * Luis (Manager, Denver), Grace (Accountant), Priya (Sales, own), Renata (Purchasing), Cole
 * (Warehouse, Colorado Springs), Marcus (Installer), Tamara (HR) and Bri (Employee).
 */
export function summitPersonas(): ReadonlyMap<DefaultRoleKey, string> {
  const { fixtures } = summitFixtures();
  const keyOf = new Map(fixtures.roles.map((role) => [role.id, role.key]));
  const active = fixtures.users.filter((person) => person.status === "active").sort((a, b) => (a.id < b.id ? -1 : 1));
  const personas = new Map<DefaultRoleKey, string>();
  for (const role of PRODUCT_ROLES.flooring) {
    const person = active.find((candidate) => candidate.roleIds.some((id) => keyOf.get(id) === role));
    if (!person) throw new Error(`No active Summit user holds the ${role} role.`);
    personas.set(role, person.email);
  }
  return personas;
}
