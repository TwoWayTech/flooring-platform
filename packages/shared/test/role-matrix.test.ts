import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, PRODUCT_ROLES, SENSITIVE, roleTemplate, type DefaultRoleKey } from "../src";

const ROLE_KEYS = PRODUCT_ROLES.flooring;

/**
 * Every default role against every permission (blueprint "Test plan": role matrix). The
 * snapshot makes any change to a default role a deliberate, reviewed edit.
 */
function matrix(): Record<DefaultRoleKey, string> {
  return Object.fromEntries(
    ROLE_KEYS.map((key) => {
      const held = new Set(roleTemplate(key).permissions);
      return [key, ALL_PERMISSION_KEYS.map((p) => (held.has(p) ? "x" : ".")).join("")];
    }),
  ) as Record<DefaultRoleKey, string>;
}

describe("default role matrix", () => {
  it("matches the reviewed snapshot", () => {
    expect(matrix()).toMatchSnapshot();
  });

  it("gives the Owner every permission", () => {
    expect(roleTemplate("owner").permissions).toEqual([...ALL_PERMISSION_KEYS]);
  });

  it("keeps cost, margin, pay rate and credit limit away from Sales, Warehouse, Installer and Employee", () => {
    const sensitive = Object.values(SENSITIVE);
    for (const key of ["sales", "warehouse", "installer", "employee"] as const) {
      const held = roleTemplate(key).permissions;
      expect(
        sensitive.filter((p) => held.includes(p)),
        key,
      ).toEqual([]);
    }
  });

  it("lets only HR and the Owner see pay rates", () => {
    const withPay = ROLE_KEYS.filter((k) => roleTemplate(k).permissions.includes(SENSITIVE.payRate));
    expect(withPay.sort()).toEqual(["hr", "owner"]);
  });
});
