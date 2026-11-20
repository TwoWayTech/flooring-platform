import { describe, expect, it } from "vitest";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";

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

describe("DemoStore's people match GET /company's directory (ADR 0051, 2026-11-20)", () => {
  it("DD1 disabled colleagues reach Settings → Users' readers only; View as narrows it", async () => {
    const dana = await open(DANA);
    const someone = (await dana.list("users")).find((u) => u.id !== DANA && u.id !== PRIYA && u.status === "active")!;
    await dana.updateUser(someone.id, { status: "disabled" });
    expect((await dana.list("users")).find((u) => u.id === someone.id)?.status).toBe("disabled");

    dana.setViewer({ userId: PRIYA, viewAsRoleId: null });
    const seen = await dana.list("users");
    expect(seen.some((u) => u.id === someone.id)).toBe(false);
    expect(seen.every((u) => u.status !== "disabled")).toBe(true);

    dana.setViewer({ userId: DANA, viewAsRoleId: null });
    const sales = (await dana.list("roles")).find((role) => role.key === "sales")!;
    dana.setViewer({ userId: DANA, viewAsRoleId: sales.id });
    expect((await dana.list("users")).some((u) => u.id === someone.id)).toBe(false);
  });
});
