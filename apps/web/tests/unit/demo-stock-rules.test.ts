import { describe, expect, it } from "vitest";
import { STOCK_RULES_MESSAGES, STOCK_RULES_OWNER_ONLY, type Role } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

async function open(userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId: null });
  return store;
}

/** Dana viewing as a custom role that holds only the Stock rules key, company-wide. */
async function asStockKeeper(): Promise<DemoStore> {
  const store = await open(DANA);
  const sales = (await store.list("roles")).find((role) => role.key === "sales")!;
  const role: Role = {
    ...sales,
    id: "sm-role-stock-rules",
    key: "stock-rules",
    name: "Stock rules",
    system: false,
    permissions: ["settings.locations.manage"],
    dataScope: "all",
  };
  await store.saveRole(role);
  store.setViewer({ userId: DANA, viewAsRoleId: role.id });
  return store;
}

describe("DemoStore Stock rules follow the API's rules (ADR 0059, the Stock rules part)", () => {
  it("DS1 a malformed quantity is refused with the shared words; nothing stored or audited", async () => {
    const store = await open(DANA);
    const before = (await store.getSettings()).inventory;
    const audits = (await store.list("audit")).length;
    for (const bad of [".", "12.", "-5", "1e3", "1.2345"])
      await expect(store.updateSettings("inventory", { adjustmentApprovalQty: bad }), bad).rejects.toThrow(
        STOCK_RULES_MESSAGES.adjustmentApprovalQty,
      );
    expect((await store.getSettings()).inventory).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("DS2 someone with the key but not an Owner can't raise or clear the quantity; nothing stored", async () => {
    const store = await asStockKeeper();
    const before = (await store.getSettings()).inventory;
    expect(before.adjustmentApprovalQty).toBe("1000");
    const audits = (await store.list("audit")).length;
    for (const looser of ["1000.001", "5000", ""])
      await expect(store.updateSettings("inventory", { adjustmentApprovalQty: looser }), looser).rejects.toThrow(
        STOCK_RULES_OWNER_ONLY,
      );
    expect((await store.getSettings()).inventory).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("DS3 the same person tightens, audited as Changed stock rules; the Owner loosens", async () => {
    const keeper = await asStockKeeper();
    await keeper.updateSettings("inventory", { adjustmentApprovalQty: "50" });
    expect((await keeper.getSettings()).inventory).toEqual({ adjustmentApprovalQty: "50" });
    keeper.setViewer({ userId: DANA, viewAsRoleId: null });
    const dana = keeper;
    const entries = (await dana.list("audit")).filter((entry) => entry.action === "Changed stock rules");
    expect(entries.map((entry) => entry.target)).toEqual(["Stock rules"]);
    await dana.updateSettings("inventory", { adjustmentApprovalQty: "" });
    expect((await dana.getSettings()).inventory).toEqual({ adjustmentApprovalQty: "" });
  });

  it("DS4 without the key the save is refused with the role words", async () => {
    const store = await open(PRIYA);
    await expect(store.updateSettings("inventory", { adjustmentApprovalQty: "10" })).rejects.toThrow(ROLE_REFUSAL);
  });
});
