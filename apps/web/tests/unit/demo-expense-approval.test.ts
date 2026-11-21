import { describe, expect, it } from "vitest";
import { EXPENSE_APPROVAL_OWNER_ONLY, type Role } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

const DANA = "sm-usr-01";

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

/** Dana viewing as a custom role that holds only the Expenses settings key, company-wide. */
async function asExpenseKeeper(): Promise<DemoStore> {
  const store = await open(DANA);
  const sales = (await store.list("roles")).find((role) => role.key === "sales")!;
  const role: Role = {
    ...sales,
    id: "sm-role-expense-approval",
    key: "expense-approval",
    name: "Expense approval",
    system: false,
    permissions: ["settings.expenses.manage"],
    dataScope: "all",
  };
  await store.saveRole(role);
  store.setViewer({ userId: DANA, viewAsRoleId: role.id });
  return store;
}

describe("DemoStore keeps loosening expense approval to the Owner (ADR 0061 decision 6, ADR 0063)", () => {
  it("DE1 someone with the key but not an Owner can't switch approval off or raise its amount; nothing stored", async () => {
    const store = await asExpenseKeeper();
    const before = (await store.getSettings()).expenses;
    expect(before).toEqual({ approvalRequired: true, approvalThreshold: "1000.00" });
    const audits = (await store.list("audit")).length;
    for (const patch of [{ approvalRequired: false }, { approvalThreshold: "1000.01" }])
      await expect(store.updateSettings("expenses", { ...before, ...patch }), JSON.stringify(patch)).rejects.toThrow(
        EXPENSE_APPROVAL_OWNER_ONLY,
      );
    expect((await store.getSettings()).expenses).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("DE2 the same person tightens; the Owner loosens", async () => {
    const keeper = await asExpenseKeeper();
    await keeper.updateSettings("expenses", { approvalRequired: true, approvalThreshold: "500.00" });
    expect((await keeper.getSettings()).expenses.approvalThreshold).toBe("500.00");
    keeper.setViewer({ userId: DANA, viewAsRoleId: null });
    await keeper.updateSettings("expenses", { approvalRequired: false, approvalThreshold: "500.00" });
    expect((await keeper.getSettings()).expenses.approvalRequired).toBe(false);
  });
});
