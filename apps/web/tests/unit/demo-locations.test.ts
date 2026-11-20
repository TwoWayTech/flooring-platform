import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  boxedStock,
  isBoxed,
  LOCATION_MESSAGES,
  SETTINGS_SCOPE_MESSAGE,
  type FeatureKey,
  type FeatureRegister,
  type Location,
  type Role,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Switches these tests turn off; every other one keeps its real value. */
const OFF = vi.hoisted(() => new Set<string>());

vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...real,
    featureOn: (key: FeatureKey, register?: FeatureRegister) => (OFF.has(key) ? false : real.featureOn(key, register)),
  };
});

afterEach(() => {
  OFF.clear();
});

/** Summit personas (fixtures): the Owner and a Sales rep; Harbor's Owner (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const HARBOR_OWNER = "hb-usr-01";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";
const MODULE_REFUSAL = "This part of the product is not switched on for your company.";
const SWITCH_REFUSAL = "This feature is switched off.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with a company open for one person. */
async function open(company: "summit" | "harbor", userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany(company, { userId, viewAsRoleId: null });
  return store;
}

/** One of Summit's locations, by name. */
async function named(store: DemoStore, name: string): Promise<Location> {
  const found = (await store.list("locations")).find((location) => location.name === name);
  expect(found, name).toBeDefined();
  return found!;
}

/** A new warehouse in Denver's branch, as the dialog sends it. */
function newWarehouse(id: string, name: string, patch: Partial<Location> = {}): Location {
  return {
    id,
    name,
    kind: "warehouse",
    branchId: "sm-br-denver",
    address: { street: "1 Annex Way", city: "Denver", state: "CO", zip: "80202" },
    isDefault: false,
    displaySamples: 0,
    ...patch,
  };
}

/** `run` is refused with `message`, and neither the locations nor the audit log change. */
async function refusedWith(store: DemoStore, run: () => Promise<unknown>, message: string) {
  const locations = await store.list("locations");
  const audits = (await store.list("audit")).length;
  await expect(run()).rejects.toThrow(message);
  expect(await store.list("locations")).toEqual(locations);
  expect(await store.list("audit")).toHaveLength(audits);
}

describe("DemoStore saves locations with the API's checks (ADR 0059, part 4a)", () => {
  it("LND1 module, key, switch, then scope, in the API's order", async () => {
    const harbor = await open("harbor", HARBOR_OWNER);
    const anywhere = newWarehouse("hb-loc-new", "Harbor Annex");
    await expect(harbor.saveLocation(anywhere)).rejects.toThrow(MODULE_REFUSAL);
    const priya = await open("summit", PRIYA);
    const southgate = await named(priya, "Southgate Showroom");
    await refusedWith(priya, () => priya.saveLocation(southgate), ROLE_REFUSAL);
    OFF.add("inventory.locations");
    await refusedWith(priya, () => priya.saveLocation(southgate), ROLE_REFUSAL);
    const dana = await open("summit", DANA);
    await refusedWith(dana, () => dana.saveLocation(southgate), SWITCH_REFUSAL);
    OFF.clear();
    const sales = (await dana.list("roles")).find((role) => role.key === "sales")!;
    const role: Role = {
      ...sales,
      id: "sm-role-branch-locations",
      key: "branch-locations",
      name: "Branch locations",
      system: false,
      permissions: ["settings.locations.manage"],
      dataScope: "branch",
    };
    await dana.saveRole(role);
    dana.setViewer({ userId: DANA, viewAsRoleId: role.id });
    await refusedWith(dana, () => dana.saveLocation(southgate), SETTINGS_SCOPE_MESSAGE);
  });

  it("LND2 the shared rule's words: a folded name, a moved branch, a floor area, the default", async () => {
    const store = await open("summit", DANA);
    const southgate = await named(store, "Southgate Showroom");
    const denver = await named(store, "Denver Central");
    const cases: [Location, string][] = [
      [{ ...southgate, name: "denver-central" }, LOCATION_MESSAGES.sameName("Denver Central")],
      [{ ...southgate, branchId: "sm-br-denver" }, LOCATION_MESSAGES.branchFixed],
      [{ ...southgate, floorAreaSqFt: "12." }, LOCATION_MESSAGES.floorArea],
      [{ ...southgate, isDefault: true }, LOCATION_MESSAGES.showroomDefault],
      [{ ...denver, isDefault: false }, LOCATION_MESSAGES.oneDefault],
    ];
    for (const [location, message] of cases) await refusedWith(store, () => store.saveLocation(location), message);
  });

  it("LND3 the holds: stock, a transfer in transit, an open quote; a quote moved away frees it", async () => {
    const store = await open("summit", DANA);
    const springs = await named(store, "Colorado Springs");
    await refusedWith(
      store,
      () => store.saveLocation({ ...springs, kind: "showroom" }),
      LOCATION_MESSAGES.holdsStock("Colorado Springs"),
    );

    const n = await store.saveLocation(newWarehouse("sm-loc-lnd3n", "LND3 North"));
    const products = await store.list("products");
    const atDenver = boxedStock(await store.list("stockMovements"), "sm-loc-denver");
    const product = products.find(
      (candidate) => isBoxed(candidate) && (atDenver.get(candidate.id)?.gte(candidate.sqFtPerCarton ?? 1) ?? false),
    )!;
    await store.createTransfer({
      fromId: "sm-loc-denver",
      toId: n.id,
      lines: [{ productId: product.id, rollId: null, quantity: product.sqFtPerCarton ?? "1" }],
      note: "",
    });
    await refusedWith(
      store,
      () => store.saveLocation({ ...n, kind: "showroom" }),
      LOCATION_MESSAGES.inTransit("LND3 North"),
    );

    const q = await store.saveLocation(newWarehouse("sm-loc-lnd3q", "LND3 Quotes"));
    const template = (await store.list("quotes")).find((quote) => quote.status === "pending")!;
    const quote = await store.saveQuote({
      ...template,
      id: "",
      number: "",
      locationId: q.id,
      lines: template.lines.map((line) => ({ ...line, locationId: undefined })),
    });
    await refusedWith(
      store,
      () => store.saveLocation({ ...q, kind: "showroom" }),
      LOCATION_MESSAGES.openQuotes("LND3 Quotes"),
    );
    await store.saveQuote({ ...quote, locationId: "sm-loc-denver" });
    expect((await store.saveLocation({ ...q, kind: "showroom" })).kind).toBe("showroom");
  });

  it("LND4 a blank floor area is stored as none, and the Business report still opens", async () => {
    const store = await open("summit", DANA);
    await store.saveLocation({
      ...newWarehouse("sm-loc-lnd4", "LND4 Annex"),
      kind: "showroom",
      floorAreaSqFt: "",
    });
    const stored = (await store.list("locations")).find((location) => location.id === "sm-loc-lnd4")!;
    expect("floorAreaSqFt" in stored).toBe(false);
    const today = store.today();
    const report = await store.businessReport({
      from: addDays(today, -89),
      to: today,
      locationIds: [],
      productCategory: null,
      expenseCategory: null,
      salesRepId: null,
      supplierId: null,
    });
    expect(JSON.stringify(report)).toContain("LND4 Annex");
  });

  it("LND5 a new default clears the old, and both are audited", async () => {
    const store = await open("summit", DANA);
    const audits = (await store.list("audit")).length;
    await store.saveLocation(newWarehouse("sm-loc-lnd5", "LND5 Default", { isDefault: true }));
    const all = await store.list("locations");
    expect(all.filter((location) => location.isDefault).map((location) => location.id)).toEqual(["sm-loc-lnd5"]);
    const log = await store.list("audit");
    expect(log).toHaveLength(audits + 2);
    const cleared = log.find((entry) => entry.action === "Changed location" && entry.target === "Denver Central");
    expect(cleared).toMatchObject({ before: "isDefault: true", after: "isDefault: false" });
    expect(log.some((entry) => entry.action === "Added location" && entry.target === "LND5 Default")).toBe(true);
  });

  it("LND6 the generic save refuses locations, so no path skips the rules", async () => {
    const store = await open("summit", DANA);
    const southgate = await named(store, "Southgate Showroom");
    await refusedWith(store, () => store.save("locations", { ...southgate, isDefault: true }), ROLE_REFUSAL);
  });
});
