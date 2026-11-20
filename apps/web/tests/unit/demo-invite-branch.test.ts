import { describe, expect, it } from "vitest";
import type { Role } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

const DANA = "sm-usr-01";
const UNKNOWN = "That branch is not one of your company's branches. Reload the page and pick another.";
const OTHER = "You can only invite people to your own branch, or move people within it.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** Summit open as Dana (Owner), with her own branch and another one of the company's. */
async function summit() {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: DANA, viewAsRoleId: null });
  const { company, user } = await store.getWorkspace();
  const own = user.branchId;
  const other = company.branches.find((branch) => branch.id !== own)!.id;
  return { store, own, other };
}

/** Dana viewed as a branch-scoped admin who may manage users (View as narrows the access, spec rule 22). */
async function asBranchAdmin(store: DemoStore) {
  const owner = (await store.list("roles")).find((role) => role.owner)!;
  const role: Role = {
    ...owner,
    id: "sm-role-branch-admin",
    key: "branch-admin",
    name: "Branch admin",
    owner: false,
    system: false,
    permissions: ["settings.users.view", "settings.users.manage"],
    dataScope: "branch",
  };
  await store.saveRole(role);
  store.setViewer({ userId: DANA, viewAsRoleId: role.id });
  return role;
}

describe("DemoStore applies the API's invite-branch rules (ADR 0051, 2026-11-20)", () => {
  it("DB1 refuses a branch that is not the company's, on an invitation and on a change", async () => {
    const { store } = await summit();
    const role = (await store.list("roles")).find((r) => r.key === "sales")!;
    await expect(
      store.inviteUser({
        name: "Nobody",
        email: "nobody@example.test",
        title: "",
        roleIds: [role.id],
        branchId: "br-x",
      }),
    ).rejects.toThrow(UNKNOWN);
    const priya = (await store.list("users")).find((u) => u.id !== DANA)!;
    await expect(store.updateUser(priya.id, { branchId: "br-x" })).rejects.toThrow(UNKNOWN);
  });

  it("DB2 keeps a branch admin's invitations to their own branch", async () => {
    const { store, own, other } = await summit();
    const role = await asBranchAdmin(store);
    const invite = (branchId: string, tag: string) =>
      store.inviteUser({ name: tag, email: `${tag}@example.test`, title: "", roleIds: [role.id], branchId });
    await expect(invite(other, "other")).rejects.toThrow(OTHER);
    await expect(invite("", "none")).rejects.toThrow(OTHER);
    expect((await invite(own, "own")).branchId).toBe(own);
  });

  it("DB3 lets a branch admin move people only from and to their own branch; an Owner moves anyone", async () => {
    const { store, own, other } = await summit();
    const users = await store.list("users");
    const elsewhere = users.find((u) => u.branchId === other)!;
    const nearby = users.find((u) => u.branchId === own && u.id !== DANA)!;
    await asBranchAdmin(store);
    await expect(store.updateUser(elsewhere.id, { branchId: own })).rejects.toThrow(OTHER);
    await expect(store.updateUser(nearby.id, { branchId: other })).rejects.toThrow(OTHER);
    store.setViewer({ userId: DANA, viewAsRoleId: null });
    expect((await store.updateUser(nearby.id, { branchId: other })).branchId).toBe(other);
  });
});
