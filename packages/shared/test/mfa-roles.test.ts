import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  decodeMemberRoles,
  encodeMemberRoles,
  memberRoleValue,
  MFA_REQUIRED_KEYS,
  MFA_REQUIRED_ROLES,
  plural,
  roleMfaChange,
  roleMfaWarning,
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

  it("covers every commission key, as it covers pay (ADR 0048): commission is pay", () => {
    const commission = ALL_PERMISSION_KEYS.filter((key) => key.startsWith("hr.commission."));
    expect(commission.length).toBe(4);
    for (const key of commission) expect(MFA_REQUIRED_KEYS).toContain(key);
  });

  it("requires MFA for the Owner, Accountant and HR manager templates and their copies, and no other template", () => {
    for (const key of ["owner", "accountant", "hr"] as const) {
      expect(roleRequiresMfa(template(key))).toBe(true);
      expect(roleRequiresMfa({ ...template(key), owner: false })).toBe(true);
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

describe("warning before a role starts needing two-step sign-in (click-through #60)", () => {
  const manager = { id: "r-manager", owner: false, permissions: ["sales.quote.view"] };
  const gained = { ...manager, permissions: [...manager.permissions, "settings.roles.manage"] };
  const hr = { id: "r-hr", owner: false, permissions: ["hr.payroll.view"] };
  const roles = [manager, hr];
  const user = (roleIds: string[], mfaEnrolled = false, status = "active") => ({ roleIds, mfaEnrolled, status });

  it("counts the holders who must set it up: not enrolled, not disabled, not already required by another role", () => {
    const users = [
      user(["r-manager"]),
      user(["r-manager"], true),
      user(["r-manager", "r-hr"]),
      user(["r-manager"], false, "disabled"),
      user(["r-hr"]),
    ];
    const change = roleMfaChange(manager, gained, roles, users)!;
    expect(change).toEqual({ keys: ["settings.roles.manage"], holders: 3, mustEnrol: 1 });
    expect(roleMfaWarning(change)).toBe(
      "This role will need two-step sign-in, because it can manage security roles. 1 of its 3 users will have to set it up at their next sign-in; the others already use it.",
    );
  });

  it("says nothing when the role needed it already or still does not", () => {
    expect(
      roleMfaChange(gained, { ...gained, permissions: [...gained.permissions, "hr.payroll.view"] }, roles, []),
    ).toBeNull();
    expect(roleMfaChange(manager, { ...manager, permissions: ["sales.quote.create"] }, roles, [])).toBeNull();
  });

  it("words every count in the singular or plural", () => {
    const keys = ["settings.users.manage", "settings.roles.manage"] as const;
    expect(roleMfaWarning({ keys: [...keys], holders: 0, mustEnrol: 0 })).toBe(
      "This role will need two-step sign-in, because it can manage users and manage security roles. Anyone given it will have to set it up at their next sign-in.",
    );
    expect(roleMfaWarning({ keys: ["settings.roles.manage"], holders: 1, mustEnrol: 1 })).toMatch(
      /Its 1 user will have to set it up at their next sign-in\.$/,
    );
    expect(roleMfaWarning({ keys: ["settings.roles.manage"], holders: 2, mustEnrol: 0 })).toMatch(
      /Its 2 users already use it\.$/,
    );
  });
});

describe("plural (click-through #46)", () => {
  it("is singular for exactly one", () => {
    expect(plural(1, "sheet is", "sheets are")).toBe("sheet is");
    expect(plural(0, "sheet is", "sheets are")).toBe("sheets are");
    expect(plural(2, "sheet is", "sheets are")).toBe("sheets are");
  });
});
