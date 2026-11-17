import type { PermissionKey } from "../permissions/catalog";
import type { DataScope } from "../permissions/roles";
import type { ModuleKey } from "../products";
import type { Branch, Role, User, UserStatus } from "../types/company";

/*
 * `GET /company` (ADR 0051, "GET /company"; docs/product-spec/settings-and-permissions.md, Real
 * build, "The shell on the API"): who is signed in to the open company and what they may do, as
 * the web shell shows it. One shape and two rules for the API and DemoStore.
 */

/** The open company's facts in `GET /company`: reference data every member may read. */
export interface CompanyAnswerCompany {
  /** The tenant id, the session's own company. */
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  /** `tenants.time_zone`, the zone the API's own date checks use (`companyClock`). */
  timeZone: string;
  modules: ModuleKey[];
  /** The company's permission ceiling, only for someone who `seesCeiling`; null for everyone else. */
  ceiling: PermissionKey[] | null;
  /** The live branches, by name. */
  branches: Branch[];
}

/** The caller's effective access on the wire: the guard's own for that request, keys sorted. */
export interface AccessWire {
  permissions: PermissionKey[];
  dataScope: DataScope;
  isOwner: boolean;
}

/** A colleague's name beside a record: nothing else about them leaves the API. */
export interface CompanyPerson {
  id: string;
  name: string;
  status: Exclude<UserStatus, "invited">;
}

/** The answer of `GET /company`. */
export interface CompanyAnswer {
  company: CompanyAnswerCompany;
  /** The caller's own profile, exactly as `GET /users` shapes it. */
  me: User;
  /** Only the roles the caller holds, as `GET /roles` shapes them (raw keys). */
  roles: Role[];
  access: AccessWire;
  /** Every live member's id, name and status; invited people are left out. */
  people: CompanyPerson[];
}

/**
 * The keys that open Settings → Security roles and Users, the keys `GET /roles` takes. Only those
 * screens read the ceiling: the role editor's "plan" lock, the role checklist's `canAssignRole`
 * and Security roles' access preview (spec rule 24, "Edit a role").
 */
export const CEILING_VIEW_KEYS: readonly PermissionKey[] = [
  "settings.roles.view",
  "settings.roles.manage",
  "settings.users.view",
  "settings.users.manage",
];

/**
 * Whether someone with these effective keys gets the company's ceiling in `GET /company` (ADR 0051,
 * "GET /company", D4): any one of `CEILING_VIEW_KEYS`. Everyone else's screens never read it.
 */
export function seesCeiling(has: (key: PermissionKey) => boolean): boolean {
  return CEILING_VIEW_KEYS.some(has);
}

/**
 * The names directory every member gets (ADR 0051, "GET /company", D5): active and disabled people,
 * so history keeps its names and Team totals keep a disabled rep, never invited ones (they haven't
 * joined, and their name came from the inviter). Each entry is exactly id, name and status, by name.
 */
export function directoryOf(rows: readonly { id: string; name: string; status: UserStatus }[]): CompanyPerson[] {
  return rows
    .flatMap(({ id, name, status }) => (status === "invited" ? [] : [{ id, name, status }]))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
