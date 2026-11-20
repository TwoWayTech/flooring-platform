import { describe, expect, it } from "vitest";
import {
  ADDRESS_MAX,
  becomesShowroom,
  companyProfileProblem,
  DISPLAY_SAMPLES_MAX,
  LOCATION_MESSAGES,
  LOCATION_NAME_MAX,
  LOCATION_RULE,
  locationHolds,
  locationHoldsProblem,
  locationProblem,
  locationStored,
  PROFILE_MESSAGES,
  QUANTITY_TEXT,
  QUANTITY_TEXT_MAX,
  SETTINGS_SECTIONS,
  streetAddressProblem,
  type Address,
  type Location,
  type LocationContext,
  type LocationInput,
  type LocationRecords,
} from "../src";

/**
 * Warehouses and showrooms' shared rules (spec settings-and-permissions.md rule 29; inventory.md
 * rule 24; ADR 0059, part 4a): content, branch, names as the stock import folds them, the default,
 * the holds that keep a warehouse from becoming a showroom, and the stored form. Every case names its
 * id first, for the mutation runs.
 */

const ADDRESS: Address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
const B1 = { id: "b1" };
const B2 = { id: "b2" };
const W: Location = {
  id: "w",
  name: "Denver Central",
  kind: "warehouse",
  branchId: "b1",
  address: ADDRESS,
  isDefault: true,
  displaySamples: 0,
  floorAreaSqFt: "18000",
};
const X: Location = { ...W, id: "x", name: "Springs", branchId: "b2", isDefault: false };
const S: Location = {
  ...W,
  id: "s",
  name: "Design Studio",
  kind: "showroom",
  isDefault: false,
  displaySamples: 140,
  floorAreaSqFt: "3200",
};

/** A location as a write sends it: everything but its id. */
function inputOf(location: Location): LocationInput {
  const copy: Partial<Location> = { ...location };
  delete copy.id;
  return copy as LocationInput;
}

/** S's fields with a change, as a write sends them. */
function input(patch: Partial<LocationInput> = {}): LocationInput {
  return { ...inputOf(S), ...patch };
}

/** Context for an edit of `before` among W, X and S, with both branches live. */
function editing(before: Location, branches = [B1, B2]): LocationContext {
  return { before, others: [W, X, S].filter((l) => l.id !== before.id), branches };
}

/** Context for a new location among W, X and S. */
const adding = (branches = [B1, B2]): LocationContext => ({ before: undefined, others: [W, X, S], branches });

/** Records that hold nothing at W. */
const EMPTY: LocationRecords = { rolls: [], movements: [], transfers: [], reservations: [], quotes: [] };

/** W's holds with one kind of record set. */
const holdsOf = (patch: Partial<LocationRecords>) => locationHolds(W.id, { ...EMPTY, ...patch });
const NONE = { stock: false, transfers: false, holds: false, quotes: false };

describe("location rules (ADR 0059, part 4a)", () => {
  it("LNR1 the rule is Stock rules' own key, switch and module", () => {
    expect(LOCATION_RULE.keys).toEqual(SETTINGS_SECTIONS.inventory.keys);
    expect(LOCATION_RULE.feature).toBe(SETTINGS_SECTIONS.inventory.feature);
    expect(LOCATION_RULE.module).toBe(SETTINGS_SECTIONS.inventory.module);
    expect(LOCATION_RULE).toEqual({
      keys: ["settings.locations.manage"],
      feature: "inventory.locations",
      module: "core",
    });
  });

  it("LNR2 the name: given, trimmed, at most 80 characters", () => {
    expect(locationProblem(input({ name: "" }), editing(S))).toBe(LOCATION_MESSAGES.name);
    expect(locationProblem(input({ name: "   " }), editing(S))).toBe(LOCATION_MESSAGES.name);
    expect(locationProblem(input({ name: ` ${"n".repeat(81)} ` }), editing(S))).toBe(LOCATION_MESSAGES.nameLength);
    expect(locationProblem(input({ name: ` ${"n".repeat(80)} ` }), editing(S))).toBeNull();
    expect(locationProblem(input({ name: "  Annex  " }), editing(S))).toBeNull();
    expect(LOCATION_NAME_MAX).toBe(80);
    expect(LOCATION_MESSAGES.nameLength).toContain("80");
  });

  it("LNR3 the kind is a warehouse or a showroom", () => {
    expect(locationProblem(input({ kind: "depot" as Location["kind"] }), editing(S))).toBe(LOCATION_MESSAGES.kind);
  });

  it("LNR4 a new location needs a live branch; an edit keeps its branch, live or not", () => {
    expect(locationProblem(input({ branchId: "sm-br-denver" }), adding())).toBe(LOCATION_MESSAGES.branch);
    expect(locationProblem(input({ name: "Annex", branchId: "b3" }), adding())).toBe(LOCATION_MESSAGES.branch);
    expect(locationProblem(input({ name: "Annex", branchId: "b1" }), adding())).toBeNull();
    expect(locationProblem(input({ branchId: "b2" }), editing(S))).toBe(LOCATION_MESSAGES.branchFixed);
    expect(locationProblem(input({ branchId: "b1" }), editing(S, [B2]))).toBeNull();
  });

  it("LNR5 the address is the company profile's rule, with its words, and no length rule of its own", () => {
    const cases: [Partial<Address>, string][] = [
      [{ street: " " }, PROFILE_MESSAGES.street],
      [{ city: "" }, PROFILE_MESSAGES.city],
      [{ state: "Colorado" }, PROFILE_MESSAGES.state],
      [{ zip: "8020" }, PROFILE_MESSAGES.zip],
      [{ lat: Number.NaN }, PROFILE_MESSAGES.position],
    ];
    for (const [patch, message] of cases) {
      const address = { ...ADDRESS, ...patch };
      expect(locationProblem(input({ address }), editing(S)), message).toBe(message);
      expect(streetAddressProblem(address), message).toBe(message);
    }
    expect(streetAddressProblem(ADDRESS)).toBeNull();
    expect(locationProblem(input({ address: { ...ADDRESS, county: "c".repeat(500) } }), editing(S))).toBeNull();
    // The profile still refuses the same address with the same words.
    const profile = {
      legalName: "Summit Floor Company LLC",
      dba: "",
      ein: "12-3456789",
      phone: "303-555-0100",
      email: "office@summit.example",
      website: "",
      address: { ...ADDRESS, zip: "8020" },
    };
    expect(companyProfileProblem(profile)).toBe(PROFILE_MESSAGES.zip);
    expect(ADDRESS_MAX).toEqual({ street: 200, city: 100, zip: 10, county: 100 });
  });

  it("LNR6 display samples: whole 0 to 100,000 on a showroom; a warehouse has none", () => {
    for (const displaySamples of [-1, 1.5, 100_001])
      expect(locationProblem(input({ displaySamples }), editing(S)), String(displaySamples)).toBe(
        LOCATION_MESSAGES.samples,
      );
    expect(locationProblem(input({ displaySamples: 0 }), editing(S))).toBeNull();
    expect(locationProblem(input({ displaySamples: 100_000 }), editing(S))).toBeNull();
    expect(locationProblem({ ...inputOf(X), displaySamples: 3 }, editing(X))).toBe(LOCATION_MESSAGES.warehouseSamples);
    expect(LOCATION_MESSAGES.samples).toContain("100,000");
    expect(DISPLAY_SAMPLES_MAX).toBe(100_000);
  });

  it("LNR7 floor area: none, blank, or sq ft with up to 3 decimals, as the API answers it", () => {
    const patch = (floorAreaSqFt: string | undefined) => {
      const sent = input();
      delete sent.floorAreaSqFt;
      return floorAreaSqFt === undefined ? sent : { ...sent, floorAreaSqFt };
    };
    for (const area of [undefined, "", "3200", "18000.000", "9999999999.999"])
      expect(locationProblem(patch(area), editing(S)), String(area)).toBeNull();
    for (const area of ["12.", ".5", "1e3", "-1", "12345678901", "1.2345", " 12", "0x10"])
      expect(locationProblem(patch(area), editing(S)), area).toBe(LOCATION_MESSAGES.floorArea);
    expect(QUANTITY_TEXT_MAX).toBe("9999999999.999".length);
    expect(QUANTITY_TEXT.test("12")).toBe(true);
    expect(QUANTITY_TEXT.test("12.5")).toBe(true);
    expect(QUANTITY_TEXT.test("12.5555")).toBe(false);
  });

  it("LNR8 names are unique as the stock import folds them, naming the stored name", () => {
    const taken = LOCATION_MESSAGES.sameName("Denver Central");
    expect(taken).toBe("Another location is already called Denver Central.");
    for (const name of [" denver central ", "Denver-Central", "denver_central", "Denver  Central"])
      expect(locationProblem(input({ name }), editing(S)), name).toBe(taken);
    expect(locationProblem(input({ name: "Denver Centre" }), editing(S))).toBeNull();
    expect(locationProblem(inputOf(W), editing(W))).toBeNull();
    expect(locationProblem(input({ name: "DENVER CENTRAL" }), editing(S))).toBe(taken);
  });

  it("LNR9 one default warehouse: never a showroom, never none", () => {
    expect(locationProblem(input({ isDefault: true }), editing(S))).toBe(LOCATION_MESSAGES.showroomDefault);
    expect(locationProblem({ ...inputOf(W), isDefault: false }, editing(W))).toBe(LOCATION_MESSAGES.oneDefault);
    const x = inputOf(X);
    expect(locationProblem({ ...x, name: "New one" }, adding())).toBeNull();
    expect(locationProblem({ ...x, name: "New one", isDefault: true }, adding())).toBeNull();
    expect(locationProblem({ ...x, name: "First" }, { before: undefined, others: [], branches: [B2] })).toBe(
      LOCATION_MESSAGES.oneDefault,
    );
  });

  it("LNR10 the first problem is answered, in the order of the rule", () => {
    expect(locationProblem(input({ name: " ", isDefault: true }), editing(S))).toBe(LOCATION_MESSAGES.name);
    expect(locationProblem(input({ name: "denver central", isDefault: true }), editing(S))).toBe(
      LOCATION_MESSAGES.sameName("Denver Central"),
    );
  });

  it("LNR11 only a stored warehouse turned showroom needs the holds check", () => {
    expect(becomesShowroom(W, { kind: "showroom" })).toBe(true);
    expect(becomesShowroom(undefined, { kind: "showroom" })).toBe(false);
    expect(becomesShowroom(S, { kind: "showroom" })).toBe(false);
    expect(becomesShowroom(S, { kind: "warehouse" })).toBe(false);
    expect(becomesShowroom(W, { kind: "warehouse" })).toBe(false);
  });

  it("LNR12 the holds: stock, transfers in transit, stock held for invoices, open quotes; short rows hold nothing", () => {
    expect(holdsOf({})).toEqual(NONE);
    const roll = (remainingLengthFt: string, locationId = W.id) => ({ locationId, remainingLengthFt });
    expect(holdsOf({ rolls: [roll("0.5")] })).toEqual({ ...NONE, stock: true });
    expect(holdsOf({ rolls: [roll("0")] })).toEqual(NONE);
    expect(holdsOf({ rolls: [roll("0.000")] })).toEqual(NONE);
    // A roll in transit keeps its sender's location (the record has no other place).
    expect(holdsOf({ rolls: [{ ...roll("40"), transferId: "t" } as LocationRecords["rolls"][number]] })).toEqual({
      ...NONE,
      stock: true,
    });
    const move = (quantity: string, productId = "p", locationId = W.id) => ({ productId, locationId, quantity });
    expect(holdsOf({ movements: [move("10"), move("-10")] })).toEqual(NONE);
    expect(holdsOf({ movements: [move("10")] })).toEqual({ ...NONE, stock: true });
    expect(holdsOf({ movements: [move("10"), move("-10"), move("3", "q")] })).toEqual({ ...NONE, stock: true });
    const transfer = (fromId: string, toId: string, status: "in_transit" | "received" = "in_transit") => ({
      fromId,
      toId,
      status,
    });
    expect(holdsOf({ transfers: [transfer(W.id, X.id)] })).toEqual({ ...NONE, transfers: true });
    expect(holdsOf({ transfers: [transfer(X.id, W.id)] })).toEqual({ ...NONE, transfers: true });
    expect(holdsOf({ transfers: [transfer(W.id, X.id, "received")] })).toEqual(NONE);
    const held = (status: "active" | "released" | "issued", quantity: string, shortBy = "0") =>
      ({ locationId: W.id, status, quantity, shortBy }) as LocationRecords["reservations"][number];
    expect(holdsOf({ reservations: [held("active", "2")] })).toEqual({ ...NONE, holds: true });
    expect(holdsOf({ reservations: [held("active", "0", "5")] })).toEqual(NONE);
    expect(holdsOf({ reservations: [held("active", "0.000", "5.000")] })).toEqual(NONE);
    expect(holdsOf({ reservations: [held("active", "2", "3")] })).toEqual({ ...NONE, holds: true });
    expect(holdsOf({ reservations: [held("released", "2"), held("issued", "2")] })).toEqual(NONE);
    const quote = (status: LocationRecords["quotes"][number]["status"], locationId = W.id, lines: string[] = []) => ({
      status,
      locationId,
      lines: lines.map((line) => ({ locationId: line })),
    });
    for (const status of ["draft", "pending", "accepted"] as const)
      expect(holdsOf({ quotes: [quote(status)] }), status).toEqual({ ...NONE, quotes: true });
    for (const status of ["converted", "declined"] as const)
      expect(holdsOf({ quotes: [quote(status)] }), status).toEqual(NONE);
    expect(holdsOf({ quotes: [quote("pending", X.id, [W.id])] })).toEqual({ ...NONE, quotes: true });
    // Every record of another location is ignored.
    expect(
      holdsOf({
        rolls: [roll("40", X.id)],
        movements: [move("10", "p", X.id)],
        transfers: [transfer(X.id, S.id)],
        reservations: [{ ...held("active", "2"), locationId: X.id }],
        quotes: [quote("pending", X.id, [X.id])],
      }),
    ).toEqual(NONE);
  });

  it("LNR13 the refusal names the first hold, in the order stock, transfer, held stock, quotes", () => {
    const all = { stock: true, transfers: true, holds: true, quotes: true };
    expect(locationHoldsProblem("W", all)).toBe(LOCATION_MESSAGES.holdsStock("W"));
    expect(locationHoldsProblem("W", { ...all, stock: false })).toBe(LOCATION_MESSAGES.inTransit("W"));
    expect(locationHoldsProblem("W", { ...NONE, holds: true, quotes: true })).toBe(
      "W has stock held for invoices. Issue it, or void the invoice, before making it a showroom.",
    );
    expect(locationHoldsProblem("W", { ...NONE, quotes: true })).toBe(LOCATION_MESSAGES.openQuotes("W"));
    expect(locationHoldsProblem("W", NONE)).toBeNull();
    expect(LOCATION_MESSAGES.holdsStock("Colorado Springs")).toBe(
      "Colorado Springs holds stock. Transfer it out before making it a showroom.",
    );
  });

  it("LNR14 the stored form: the name trimmed, a blank floor area left out, the rest as sent", () => {
    const sent = input({ name: "  Annex  ", floorAreaSqFt: "" });
    const stored = locationStored(sent);
    expect(stored.name).toBe("Annex");
    expect("floorAreaSqFt" in stored).toBe(false);
    expect(locationStored(input({ floorAreaSqFt: "2400" })).floorAreaSqFt).toBe("2400");
    expect({ ...stored, name: sent.name, floorAreaSqFt: sent.floorAreaSqFt }).toEqual(sent);
  });
});
