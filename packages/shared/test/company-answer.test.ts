import { describe, expect, it } from "vitest";
import type { PermissionKey } from "../src/permissions/catalog";
import { roleTemplate } from "../src/permissions/roles";
import { CEILING_VIEW_KEYS, directoryOf, seesCeiling } from "../src/platform/company-answer";
import type { UserStatus } from "../src/types/company";

/** A key check over a fixed set, as the API and DemoStore pass one. */
const holds =
  (...keys: readonly PermissionKey[]) =>
  (key: PermissionKey) =>
    keys.includes(key);

describe("GET /company's shared rules (ADR 0051, 'GET /company')", () => {
  it("1 seesCeiling: any one of the four role and user settings keys, and nothing else", () => {
    expect(CEILING_VIEW_KEYS).toEqual([
      "settings.roles.view",
      "settings.roles.manage",
      "settings.users.view",
      "settings.users.manage",
    ]);
    for (const key of CEILING_VIEW_KEYS) expect(seesCeiling(holds(key)), key).toBe(true);
    expect(seesCeiling(holds())).toBe(false);
    for (const role of ["sales", "warehouse", "installer", "accountant", "employee", "purchasing"] as const) {
      expect(seesCeiling(holds(...roleTemplate(role).permissions)), role).toBe(false);
    }
    expect(seesCeiling(holds(...roleTemplate("manager").permissions))).toBe(true);
  });

  it("2 directoryOf: active and disabled people by name, exactly id, name and status, never invited ones", () => {
    const rows: { id: string; name: string; status: UserStatus; email?: string; roleIds?: string[] }[] = [
      { id: "u3", name: "Zoe Park", status: "active", email: "zoe@example.test", roleIds: ["r1"] },
      { id: "u1", name: "Ana Diaz", status: "disabled", email: "ana@example.test" },
      { id: "u2", name: "Ivy Chen", status: "invited", email: "ivy@example.test" },
      { id: "u4", name: "Ben Ode", status: "active" },
    ];
    const people = directoryOf(rows);
    expect(people).toEqual([
      { id: "u1", name: "Ana Diaz", status: "disabled" },
      { id: "u4", name: "Ben Ode", status: "active" },
      { id: "u3", name: "Zoe Park", status: "active" },
    ]);
    for (const person of people) expect(Object.keys(person).sort()).toEqual(["id", "name", "status"]);
    expect(people.map((person) => person.id)).not.toContain("u2");
  });
});
