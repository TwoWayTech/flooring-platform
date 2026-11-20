import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorkspace } from "@/components/workspace/open-workspace";
import { viewerAccess } from "@/lib/access";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

const before = process.env.NEXT_PUBLIC_DATA_SOURCE;

/** Summit personas (fixtures): the Owner, the Manager (users view), a Sales rep and the warehouse lead. */
const DANA = "sm-usr-01";
const LUIS = "sm-usr-02";
const PRIYA = "sm-usr-03";
const COLE = "sm-usr-04";
const SALES_ROLE = "sm-role-sales";

/** No proof files in these tests. */
const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with Summit open for one person, viewing as `viewAsRoleId` (each test starts from the fixtures). */
async function summit(userId: string, viewAsRoleId: string | null = null): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId });
  return store;
}

afterEach(() => {
  if (before === undefined) delete process.env.NEXT_PUBLIC_DATA_SOURCE;
  else process.env.NEXT_PUBLIC_DATA_SOURCE = before;
  vi.restoreAllMocks();
});

describe("DemoStore's workspace and opening it (ADR 0051, 'GET /company', D4, D16)", () => {
  it("D1 Priya: herself, every Summit role, the access the shell worked out before, and no ceiling", async () => {
    const store = await summit(PRIYA);
    const facts = await store.getWorkspace();
    const company = await store.getCompany();
    const roles = await store.list("roles");
    const priya = (await store.list("users")).find((user) => user.id === PRIYA)!;
    expect(facts.user).toEqual(priya);
    expect(facts.roles).toEqual(roles);
    expect(facts.access).toEqual(viewerAccess(company, roles, priya, null));
    const { name, city, state, modules, branches } = company;
    expect(facts.company).toEqual({ name, city, state, modules, branches, ceiling: [] });
  });

  it("D2 Luis, who views users, gets the company's ceiling", async () => {
    const store = await summit(LUIS);
    expect((await store.getWorkspace()).company.ceiling).toEqual((await store.getCompany()).ceiling);
  });

  it("D3 Dana gets the company's ceiling and is the Owner", async () => {
    const store = await summit(DANA);
    const facts = await store.getWorkspace();
    expect(facts.company.ceiling).toEqual((await store.getCompany()).ceiling);
    expect(facts.access.isOwner).toBe(true);
  });

  it("D4 with View as set on the store, the facts are still the person's own (View as is the shell's)", async () => {
    const store = await summit(DANA);
    const own = (await store.getWorkspace()).access;
    store.setViewer({ userId: DANA, viewAsRoleId: SALES_ROLE });
    expect((await store.getWorkspace()).access).toEqual(own);
  });

  it("D5 a stored Sales choice is not applied for Cole: the store keeps acting as Cole", async () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    const store = new DemoStore(noFiles);
    const applied = await openWorkspace(store, { companyId: "summit", userId: COLE }, SALES_ROLE);
    expect(applied).toBeNull();
    const cole = await summit(COLE);
    expect((await store.getWorkspace()).access).toEqual((await cole.getWorkspace()).access);
    const quotes = await store.list("quotes");
    expect(quotes).toEqual(await cole.list("quotes"));
    expect(quotes).not.toEqual(await (await summit(COLE, SALES_ROLE)).list("quotes"));
  });

  it("D6 a stored Sales choice applies for Dana in the demo, and is never read in api mode", async () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    const store = new DemoStore(noFiles);
    expect(await openWorkspace(store, { companyId: "summit", userId: DANA }, SALES_ROLE)).toBe(SALES_ROLE);
    const asSales = await summit(DANA, SALES_ROLE);
    expect(await store.list("quotes")).toEqual(await asSales.list("quotes"));
    expect(await store.list("quotes")).not.toEqual(await (await summit(DANA)).list("quotes"));

    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    const apiStore = new DemoStore(noFiles);
    const read = vi.spyOn(apiStore, "getWorkspace");
    expect(await openWorkspace(apiStore, { companyId: "summit", userId: DANA }, SALES_ROLE)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(await apiStore.list("quotes")).toEqual(await (await summit(DANA)).list("quotes"));
  });
});
