import { describe, expect, it } from "vitest";
import { PAYMENT_CONTROLS_OWNER_ONLY } from "@workspace/shared";
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

/** Summit's Accountant, found by role so the test follows the fixture. */
async function accountantId(): Promise<string> {
  const owner = await open(DANA);
  const role = (await owner.list("roles")).find((r) => r.key === "accountant")!;
  return (await owner.list("users")).find((u) => u.roleIds.includes(role.id))!.id;
}

describe("DemoStore keeps loosening a payment control to the Owner (ADR 0059, 2026-11-20)", () => {
  it("DP1 the Accountant can't switch approval off or raise the limits, and nothing is stored", async () => {
    const store = await open(await accountantId());
    const before = (await store.getSettings()).payments;
    const audits = (await store.list("audit")).length;
    for (const patch of [{ approvalRequired: false }, { approvalThreshold: "5000.00" }, { writeOffMax: "" }]) {
      await expect(store.updateSettings("payments", { ...before, ...patch })).rejects.toThrow(
        PAYMENT_CONTROLS_OWNER_ONLY,
      );
    }
    expect((await store.getSettings()).payments).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("DP2 the Accountant tightens; the Owner loosens", async () => {
    const grace = await open(await accountantId());
    const before = (await grace.getSettings()).payments;
    await grace.updateSettings("payments", { ...before, writeOffMax: "1.00" });
    const dana = await open(DANA);
    const stored = (await dana.getSettings()).payments;
    await dana.updateSettings("payments", { ...stored, approvalRequired: false, writeOffMax: "" });
    expect((await dana.getSettings()).payments).toMatchObject({ approvalRequired: false, writeOffMax: "" });
  });
});
