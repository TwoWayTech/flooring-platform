import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Role, User } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import { mayViewAs, viewAsOffered, viewAsRoleFor } from "@/lib/view-as";

const before = process.env.NEXT_PUBLIC_DATA_SOURCE;

/** No proof files in these tests. */
const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

let roles: Role[] = [];
let users: User[] = [];
const user = (id: string) => users.find((candidate) => candidate.id === id)!;
/** Someone holding exactly these roles, for the custom-role cases. */
const holding = (...roleIds: string[]): User => ({ ...user("sm-usr-03"), id: "custom-user", roleIds });

beforeAll(async () => {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
  roles = await store.list("roles");
  users = await store.list("users");
});

afterEach(() => {
  if (before === undefined) delete process.env.NEXT_PUBLIC_DATA_SOURCE;
  else process.env.NEXT_PUBLIC_DATA_SOURCE = before;
});

describe("who may view as, and when a stored choice applies (ADR 0051, 'GET /company', D2 and D16)", () => {
  it("V1 View as is offered in the demo only", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    expect(viewAsOffered()).toBe(true);
    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    expect(viewAsOffered()).toBe(false);
  });

  it("V2 mayViewAs: the Owner, or a held role listing settings.roles.manage; not Sales, Warehouse or Manager", () => {
    const manager = roles.find((role) => role.key === "manager")!;
    expect(manager.permissions).toContain("settings.users.view");
    expect(mayViewAs(user("sm-usr-01"), roles)).toBe(true);
    const custom: Role = { ...manager, id: "role-custom", key: "custom", permissions: ["settings.roles.manage"] };
    expect(mayViewAs(holding("role-custom"), [...roles, custom])).toBe(true);
    expect(mayViewAs(user("sm-usr-03"), roles)).toBe(false);
    expect(mayViewAs(user("sm-usr-04"), roles)).toBe(false);
    expect(mayViewAs(user("sm-usr-02"), roles)).toBe(false);
  });

  it("V3 in the demo a stored role applies to Dana, who may view as, and not to Cole, who may not", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    expect(viewAsRoleFor("sm-role-sales", user("sm-usr-01"), roles)?.id).toBe("sm-role-sales");
    expect(viewAsRoleFor("sm-role-sales", user("sm-usr-04"), roles)).toBeNull();
  });

  it("V4 in the demo never the owner role, an unknown role or no choice", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    const dana = user("sm-usr-01");
    expect(viewAsRoleFor("sm-role-owner", dana, roles)).toBeNull();
    expect(viewAsRoleFor("sm-role-unknown", dana, roles)).toBeNull();
    expect(viewAsRoleFor(null, dana, roles)).toBeNull();
  });

  it("V5 in api mode a stored role never applies, even for the Owner", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    expect(viewAsRoleFor("sm-role-sales", user("sm-usr-01"), roles)).toBeNull();
  });
});
