import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  decodeMemberRoles,
  encodeMemberRoles,
  memberRoleValue,
  MFA_REQUIRED_KEYS,
  MFA_REQUIRED_ROLES,
  roleRequiresMfa,
  rolesRequireMfa,
  roleTemplate,
  type DefaultRoleKey,
} from "../src";

describe("mandatory MFA by role (blueprint p27)", () => {
  it("covers Owner, Accountant and HR", () => {
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(["accountant", "hr", "owner"]);
  });

  it("requires MFA when any held role needs it", () => {
    expect(rolesRequireMfa(["employee", "hr"])).toBe(true);
    expect(rolesRequireMfa(["owner"])).toBe(true);
    expect(rolesRequireMfa(["accountant"])).toBe(true);
  });

  it("does not require it for other roles or none", () => {
    expect(rolesRequireMfa(["sales", "warehouse", "employee"])).toBe(false);
    expect(rolesRequireMfa([])).toBe(false);
  });

  it("round-trips role keys through member.role, sorted and without duplicates", () => {
    expect(encodeMemberRoles(["hr", "employee", "hr"])).toBe("employee,hr");
    expect(decodeMemberRoles("employee,hr")).toEqual(["employee", "hr"]);
    expect(decodeMemberRoles(" owner , ")).toEqual(["owner"]);
    expect(decodeMemberRoles(null)).toEqual([]);
  });
});

describe("mandatory MFA by role content (P10 part 2)", () => {
  const template = (key: DefaultRoleKey) => ({ ...roleTemplate(key), owner: key === "owner" });

  it("names only real permission keys", () => {
    for (const key of MFA_REQUIRED_KEYS) expect(ALL_PERMISSION_KEYS).toContain(key);
  });

  it("requires MFA for the Owner, Accountant and HR manager templates and their copies, and no other template", () => {
    for (const key of ["owner", "accountant", "hr"] as const) {
      expect(roleRequiresMfa(template(key))).toBe(true);
      expect(roleRequiresMfa({ ...template(key), owner: false, key: "custom" } as never)).toBe(key !== "owner" || true);
    }
    for (const key of ["manager", "sales", "purchasing", "warehouse", "installer"] as const) {
      expect(roleRequiresMfa(template(key))).toBe(false);
    }
  });

  it("writes the mfa marker into member.role so sign-in can decide before a company database opens", () => {
    const copy = { key: "custom-ap", owner: false, permissions: ["sales.payment.approve"] };
    const value = memberRoleValue([copy, { key: "sales", owner: false, permissions: [] }]);
    expect(value).toBe("custom-ap,mfa,sales");
    expect(rolesRequireMfa(decodeMemberRoles(value))).toBe(true);
    expect(memberRoleValue([{ key: "sales", owner: false, permissions: ["sales.quote.create"] }])).toBe("sales");
  });
});
