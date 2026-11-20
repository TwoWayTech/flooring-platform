import {
  isModuleKey,
  isPermissionKey,
  type CompanyAnswer,
  type CompanyId,
  type PermissionKey,
  type User,
} from "@workspace/shared";
import type { WorkspaceFacts } from "../contract";

/**
 * The shell's facts from `GET /company` (ADR 0051, "GET /company"): the person, the roles they hold
 * and the guard's own access, used as is (D3). Keys and modules this build doesn't know are
 * dropped, so a newer API never widens an older web (fail closed). A ceiling the API keeps back
 * (D4) reads as none. `company.timeZone` is kept for `today()` by the route that reads the answer
 * (`lib/api/company-day.ts`; ADR 0051, "The company's day on the web").
 */
export function workspaceFromAnswer(answer: CompanyAnswer): WorkspaceFacts {
  const { name, city, state, modules, ceiling, branches } = answer.company;
  return {
    company: {
      name,
      city,
      state,
      modules: modules.filter((key) => isModuleKey(key)),
      ceiling: (ceiling ?? []).filter((key) => isPermissionKey(key)),
      branches,
    },
    user: answer.me,
    roles: answer.roles,
    access: {
      permissions: new Set<PermissionKey>(answer.access.permissions.filter((key) => isPermissionKey(key))),
      dataScope: answer.access.dataScope,
      isOwner: answer.access.isOwner,
    },
  };
}

/**
 * `GET /company`'s people as the screens' `User` records, for `list("users")` in api mode (D5): each
 * entry is a name beside a record, never the person's record (Settings → Users reads
 * `listSettingsUsers`), so only id, name and status are filled. `companyId` is the tenant's UUID,
 * cast as `roleView` does on the API; the shell's `company.id` stays DemoStore's, so the two are
 * never compared.
 */
export function peopleAsUsers(answer: CompanyAnswer): User[] {
  return answer.people.map((person) => ({
    id: person.id,
    companyId: answer.company.id as CompanyId,
    name: person.name,
    email: "",
    title: "",
    roleIds: [],
    branchId: "",
    status: person.status,
    mfaEnrolled: false,
    lastLoginAt: null,
    employeeId: null,
    defaultLocationId: null,
  }));
}
