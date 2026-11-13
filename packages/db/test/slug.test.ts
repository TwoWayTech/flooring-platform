import { describe, expect, it } from "vitest";
import { slugProblem } from "../src/provision-tenant";

describe("slugProblem (P9: a slug is a subdomain and part of a database name)", () => {
  it("accepts lowercase letters and digits starting with a letter", () => {
    expect(slugProblem("summit")).toBeNull();
    expect(slugProblem("keystone2")).toBeNull();
  });

  it("refuses other characters, a leading digit, and lengths outside 2 to 31", () => {
    for (const slug of ["Summit", "sum-mit", "sum_mit", "2summit", "s", "a".repeat(32), ""]) {
      expect(slugProblem(slug)).toMatch(/lowercase letters and digits/);
    }
  });

  it("refuses the platform's own subdomains", () => {
    for (const slug of ["www", "api", "app", "admin", "hr", "flooring"]) {
      expect(slugProblem(slug)).toMatch(/reserved/);
    }
  });
});
