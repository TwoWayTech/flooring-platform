import { describe, expect, it } from "vitest";
import type { CompanyAnswer, PermissionKey, Quote, Role, User } from "@workspace/shared";
import { fakeApi } from "./fake-api";

const TENANT = "0195f3a2-7b1c-7d4e-8f00-0000000000c1";
const PRIYA = "0195f3a2-7b1c-7d4e-8f00-0000000000a3";
const COLE = "0195f3a2-7b1c-7d4e-8f00-0000000000a4";
const VICTOR = "0195f3a2-7b1c-7d4e-8f00-0000000000a5";
const SALES_ROLE = "0195f3a2-7b1c-7d4e-8f00-0000000000b1";
const DENVER = "0195f3a2-7b1c-7d4e-8f00-0000000000d1";
const SPRINGS = "0195f3a2-7b1c-7d4e-8f00-0000000000d2";

/** Priya as GET /users and GET /company's `me` shape her. */
const me: User = {
  id: PRIYA,
  companyId: TENANT as User["companyId"],
  name: "Priya Natarajan",
  email: "priya@example.test",
  title: "Sales consultant",
  roleIds: [SALES_ROLE],
  branchId: DENVER,
  status: "active",
  mfaEnrolled: false,
  lastLoginAt: null,
  employeeId: null,
  defaultLocationId: null,
};

/** The Sales role as GET /roles shapes it. */
const sales: Role = {
  id: SALES_ROLE,
  companyId: TENANT as Role["companyId"],
  key: "sales",
  name: "Sales",
  description: "Quotes and customers",
  permissions: ["dashboard.overview.view", "sales.quote.view", "sales.quote.create"],
  dataScope: "own",
  system: true,
  owner: false,
};

/** A GET /company answer for Priya. */
function answer(overrides: Partial<CompanyAnswer> = {}): CompanyAnswer {
  return {
    company: {
      id: TENANT,
      slug: "summit",
      name: "Summit Floor Co.",
      city: "Denver",
      state: "CO",
      timeZone: "America/Denver",
      modules: ["platform", "core", "retail"],
      ceiling: ["dashboard.overview.view", "sales.quote.view"],
      branches: [
        { id: SPRINGS, name: "Colorado Springs", city: "Colorado Springs", state: "CO" },
        { id: DENVER, name: "Denver", city: "Denver", state: "CO" },
      ],
    },
    me,
    roles: [sales],
    access: { permissions: ["dashboard.overview.view", "sales.quote.view"], dataScope: "own", isOwner: false },
    people: [
      { id: COLE, name: "Cole Brennan", status: "active" },
      { id: PRIYA, name: "Priya Natarajan", status: "active" },
      { id: VICTOR, name: "Victor Sims", status: "disabled" },
    ],
    ...overrides,
  };
}

const served = (body: CompanyAnswer) => ({ "GET /company": { status: 200, body } });

describe("the shell from GET /company (ADR 0051, 'GET /company')", () => {
  it("W1 getWorkspace() sends exactly GET /company and maps the person, roles, access and company facts", async () => {
    const fake = fakeApi(served(answer()));
    const facts = await fake.client.getWorkspace();
    expect(fake.calls()).toEqual(["GET /company"]);
    expect(facts.access.permissions).toBeInstanceOf(Set);
    expect([...facts.access.permissions].sort()).toEqual(["dashboard.overview.view", "sales.quote.view"]);
    expect(facts.access.dataScope).toBe("own");
    expect(facts.access.isOwner).toBe(false);
    expect(facts.user).toEqual(me);
    expect(facts.roles).toEqual([sales]);
    expect(facts.company).toEqual({
      name: "Summit Floor Co.",
      city: "Denver",
      state: "CO",
      modules: ["platform", "core", "retail"],
      ceiling: ["dashboard.overview.view", "sales.quote.view"],
      branches: answer().company.branches,
    });
  });

  it("W2 an unknown key or module is dropped, so a newer API never widens an older web", async () => {
    const newer = answer();
    newer.company.modules = [...newer.company.modules, "made-up" as never];
    newer.access.permissions = [...newer.access.permissions, "made.up.key" as PermissionKey];
    const facts = await fakeApi(served(newer)).client.getWorkspace();
    expect([...facts.access.permissions]).not.toContain("made.up.key");
    expect(facts.access.permissions.size).toBe(2);
    expect(facts.company.modules).toEqual(["platform", "core", "retail"]);
  });

  it("W3 a ceiling the API keeps back reads as none", async () => {
    const kept = answer();
    kept.company.ceiling = null;
    expect((await fakeApi(served(kept)).client.getWorkspace()).company.ceiling).toEqual([]);
  });

  it('W4 list("users") gives GET /company\'s people as users: id, name and status, nothing else', async () => {
    const fake = fakeApi(served(answer()));
    const users = await fake.client.list("users");
    expect(fake.calls()).toEqual(["GET /company"]);
    expect(users.map((user) => [user.id, user.name, user.status])).toEqual([
      [COLE, "Cole Brennan", "active"],
      [PRIYA, "Priya Natarajan", "active"],
      [VICTOR, "Victor Sims", "disabled"],
    ]);
    for (const user of users) {
      expect(user).toMatchObject({
        companyId: TENANT,
        email: "",
        title: "",
        roleIds: [],
        branchId: "",
        mfaEnrolled: false,
        lastLoginAt: null,
        employeeId: null,
        defaultLocationId: null,
      });
    }
    expect((await fake.client.get("users", VICTOR))?.name).toBe("Victor Sims");
    expect(await fake.client.get("users", "0195f3a2-7b1c-7d4e-8f00-0000000000ff")).toBeUndefined();
  });

  it("W5 whoAmI() is the API's own id from GET /auth/context", async () => {
    const fake = fakeApi({
      "GET /auth/context": {
        status: 200,
        body: { user: { id: PRIYA, name: "Priya", email: "p@example.test" }, company: null, companies: [] },
      },
    });
    expect(await fake.client.whoAmI()).toBe(PRIYA);
    expect(fake.calls()).toEqual(["GET /auth/context"]);
  });

  it("W6 saveQuote sends neither the rep nor the branch, on a new quote and a saved one", async () => {
    const quote = {
      id: "draft-1",
      number: "",
      customerId: "c1",
      salesRepId: "sm-usr-03",
      branchId: "sm-br-denver",
      locationId: "l1",
      lines: [{ id: "line-1", description: "Oak" }],
      notes: "Back room",
    } as unknown as Quote;
    const fake = fakeApi();
    await fake.client.saveQuote(quote).catch(() => undefined);
    await fake.client.saveQuote({ ...quote, id: PRIYA, number: "Q-2001" }).catch(() => undefined);
    expect(fake.sent.map((s) => s.call)).toEqual(["POST /quotes", `PUT /quotes/${PRIYA}`]);
    const rest: Record<string, unknown> = { ...quote };
    delete rest.salesRepId;
    delete rest.branchId;
    expect(fake.sent[0].body).toEqual(rest);
    expect(fake.sent[1].body).toEqual({ ...rest, id: PRIYA, number: "Q-2001" });
  });
});
