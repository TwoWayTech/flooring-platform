import { describe, expect, it } from "vitest";
import { hostCompanySlug, pickCompany } from "../src/core/auth/company-pick";

describe("hostCompanySlug", () => {
  it("reads the company from a subdomain", () => {
    expect(hostCompanySlug("summit.flooringsuite.com")).toBe("summit");
    expect(hostCompanySlug("Summit.FlooringSuite.com:443")).toBe("summit");
  });

  it("finds none on localhost, IP addresses or a bare domain", () => {
    expect(hostCompanySlug("localhost:3000")).toBeUndefined();
    expect(hostCompanySlug("127.0.0.1:3000")).toBeUndefined();
    expect(hostCompanySlug("flooringsuite.com")).toBeUndefined();
    expect(hostCompanySlug(undefined)).toBeUndefined();
  });
});

describe("pickCompany", () => {
  it("opens the host's company for its members and refuses everyone else", () => {
    expect(pickCompany("a", ["a", "b"])).toEqual({ kind: "open", companyId: "a" });
    expect(pickCompany("c", ["a", "b"])).toEqual({ kind: "refuse", reason: "not_a_member" });
  });

  it("without a host company, opens the only one, asks to choose among several, refuses none", () => {
    expect(pickCompany(null, ["a"])).toEqual({ kind: "open", companyId: "a" });
    expect(pickCompany(null, ["a", "b"])).toEqual({ kind: "choose" });
    expect(pickCompany(null, [])).toEqual({ kind: "refuse", reason: "no_company" });
  });
});
