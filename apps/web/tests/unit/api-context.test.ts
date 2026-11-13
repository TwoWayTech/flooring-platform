import { describe, expect, it } from "vitest";
import { toCompanySession, type SessionContext } from "@/lib/session/api-context";

const summit = { id: "986ecd96-225c-5088-a04a-e9e7d56a7210", slug: "summit", name: "Summit Floor Co." };

function context(email: string, company: SessionContext["company"] = summit): SessionContext {
  return { user: { id: "0193f0e0-0000-7000-8000-000000000001", name: "Someone", email }, company, companies: [summit] };
}

describe("toCompanySession (api mode bridge to the workspace session)", () => {
  it("matches the signed-in user to their seeded profile by email, ignoring case", async () => {
    const session = await toCompanySession(context("Dana.Whitfield@summitfloor.example"), "flooring");
    expect(session).toEqual({
      kind: "company",
      companyId: "summit",
      product: "flooring",
      userId: "sm-usr-01",
      roleKey: "owner",
    });
  });

  it("has no workspace session until a company is open", async () => {
    expect(await toCompanySession(context("dana.whitfield@summitfloor.example", null), "flooring")).toBeNull();
  });

  it("has none for an account without a seeded profile or a company the web app does not know", async () => {
    expect(await toCompanySession(context("nobody@example.test"), "flooring")).toBeNull();
    const unknown = { id: "0193f0e0-0000-7000-8000-000000000002", slug: "acme", name: "Acme" };
    expect(await toCompanySession(context("dana.whitfield@summitfloor.example", unknown), "flooring")).toBeNull();
  });
});
