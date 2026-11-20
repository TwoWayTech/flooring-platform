import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Access, Company, CompanySettings, PermissionKey, Role, User } from "@workspace/shared";
import { buildWorkspace } from "@/components/workspace/build-workspace";
import { viewerAccess } from "@/lib/access";
import type { CompanyFacts, WorkspaceFacts } from "@/lib/api/contract";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import type { CompanySession } from "@/lib/session/session";

const before = process.env.NEXT_PUBLIC_DATA_SOURCE;

/** No proof files in these tests. */
const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

let base: Company;
let settings: CompanySettings;
let roles: Role[] = [];
let users: User[] = [];
const user = (id: string) => users.find((candidate) => candidate.id === id)!;
const roleOf = (key: string) => roles.find((role) => role.key === key)!;

beforeAll(async () => {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
  base = await store.getCompany();
  settings = await store.getSettings();
  roles = await store.list("roles");
  users = await store.list("users");
});

afterEach(() => {
  if (before === undefined) delete process.env.NEXT_PUBLIC_DATA_SOURCE;
  else process.env.NEXT_PUBLIC_DATA_SOURCE = before;
});

/** The company facts of `base`, with `changes` laid over them. */
function companyFacts(changes: Partial<CompanyFacts> = {}): CompanyFacts {
  const { name, city, state, modules, ceiling, branches } = base;
  return { name, city, state, modules, ceiling, branches, ...changes };
}

/** What the shell reads for `userId`: the facts (with this access), DemoStore's company and the settings. */
function read(userId: string, access: Access, company: Partial<CompanyFacts> = {}, factRoles = roles) {
  const facts: WorkspaceFacts = { company: companyFacts(company), user: user(userId), roles: factRoles, access };
  return { facts, base, settings };
}

/** The workspace for `userId` viewing as `viewAs`. */
function build(reading: ReturnType<typeof read>, userId: string, viewAs: string | null) {
  const session: CompanySession = {
    kind: "company",
    companyId: "summit",
    product: "flooring",
    userId,
    roleKey: "owner",
  };
  return buildWorkspace(reading, { session, viewAs, setViewAs: () => undefined });
}

const only = (...keys: PermissionKey[]): Access => ({ permissions: new Set(keys), dataScope: "own", isOwner: false });

describe("the shell's workspace from the facts (ADR 0051, 'GET /company', D3, D16)", () => {
  it("B1 api mode: the access is the facts' own, never worked out again from the roles and ceiling", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    const access = only("dashboard.overview.view");
    const workspace = build(read("sm-usr-03", access, {}, [roleOf("sales")]), "sm-usr-03", null);
    expect(roleOf("sales").permissions).toContain("sales.quote.view");
    expect(workspace.access).toBe(access);
    expect([...workspace.access.permissions]).toEqual(["dashboard.overview.view"]);
  });

  it("B2 api mode: a View as role is ignored", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    const access = viewerAccess(base, roles, user("sm-usr-01"), null);
    const workspace = build(read("sm-usr-01", access), "sm-usr-01", "sm-role-sales");
    expect(workspace.viewAsRole).toBeNull();
    expect(workspace.access).toBe(access);
  });

  it("B3 demo mode: Dana viewing as Sales gets Sales's access, as before", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    const dana = user("sm-usr-01");
    const workspace = build(read("sm-usr-01", viewerAccess(base, roles, dana, null)), "sm-usr-01", "sm-role-sales");
    expect(workspace.viewAsRole?.id).toBe("sm-role-sales");
    expect(workspace.access).toEqual(viewerAccess(base, roles, dana, "sm-role-sales"));
  });

  it("B4 the facts' name, modules, ceiling and branches lie over DemoStore's company; its id, plan and limits stay", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    const branches = [{ id: "0195f3a2-7b1c-7d4e-8f00-0000000000d1", name: "Denver", city: "Denver", state: "CO" }];
    const facts = { name: "Summit (API)", modules: ["platform" as const, "core" as const], ceiling: [], branches };
    const workspace = build(read("sm-usr-03", only("dashboard.overview.view"), facts), "sm-usr-03", null);
    expect(workspace.company).toMatchObject(facts);
    expect(workspace.company).toMatchObject({
      id: base.id,
      plan: base.plan,
      status: base.status,
      userLimit: base.userLimit,
      branchLimit: base.branchLimit,
      product: base.product,
      createdAt: base.createdAt,
    });
    expect(workspace.settings).toBe(settings);
    expect(workspace.user).toEqual(user("sm-usr-03"));
  });

  it("B5 demo mode: Cole, who may not view as, keeps his own access with a stored Sales choice", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    const access = viewerAccess(base, roles, user("sm-usr-04"), null);
    const workspace = build(read("sm-usr-04", access, { ceiling: [] }), "sm-usr-04", "sm-role-sales");
    expect(workspace.viewAsRole).toBeNull();
    expect(workspace.access).toBe(access);
    expect(workspace.access.permissions.size).toBeGreaterThan(0);
  });

  it("B6 demo mode: a View as access is worked out against DemoStore's own company, never a trimmed ceiling", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    const custom: Role = {
      ...roleOf("manager"),
      id: "role-custom",
      key: "custom",
      permissions: ["settings.roles.manage"],
    };
    const manager: User = { ...user("sm-usr-02"), id: "custom-user", roleIds: ["role-custom"] };
    users = [...users, manager];
    const all = [...roles, custom];
    const reading = read("custom-user", only("dashboard.overview.view"), { ceiling: [] }, all);
    const workspace = build(reading, "custom-user", "sm-role-sales");
    expect(workspace.viewAsRole?.id).toBe("sm-role-sales");
    expect(workspace.access).toEqual(viewerAccess(base, all, manager, "sm-role-sales"));
    expect(workspace.access.permissions.size).toBeGreaterThan(0);
  });
});
