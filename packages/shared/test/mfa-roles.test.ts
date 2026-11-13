import { describe, expect, it } from "vitest";
import { decodeMemberRoles, encodeMemberRoles, MFA_REQUIRED_ROLES, rolesRequireMfa } from "../src";

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
