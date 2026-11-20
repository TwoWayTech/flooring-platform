import { describe, expect, it } from "vitest";
import { LOCATION_MESSAGES, type Branch, type Location } from "@workspace/shared";
import { LOCATION_FORM, locationSave, type LocationForm } from "@/features/settings/locations/location-dialog";

const BRANCHES: Branch[] = [
  { id: "b1", name: "Denver", city: "Denver", state: "CO" },
  { id: "b2", name: "Colorado Springs", city: "Colorado Springs", state: "CO" },
];
const ADDRESS = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202", county: "" };
const DENVER: Location = {
  id: "w",
  name: "Denver Central",
  kind: "warehouse",
  branchId: "b1",
  address: ADDRESS,
  isDefault: true,
  displaySamples: 0,
  floorAreaSqFt: "18000.000",
};
const STUDIO: Location = {
  ...DENVER,
  id: "s",
  name: "Design Studio",
  kind: "showroom",
  isDefault: false,
  displaySamples: 140,
  floorAreaSqFt: "3200.000",
};
const ALL = [DENVER, STUDIO];

/** The dialog's values for a location, with a change. */
function values(location: Location, patch: Partial<LocationForm> = {}): LocationForm {
  return {
    name: location.name,
    kind: location.kind,
    branchId: location.branchId,
    address: ADDRESS,
    isDefault: location.isDefault,
    displaySamples: location.displaySamples,
    floorAreaSqFt: location.floorAreaSqFt ?? "",
    ...patch,
  };
}

/** The form's first message for these values, or null. */
function formProblem(form: LocationForm): string | null {
  const parsed = LOCATION_FORM.safeParse(form);
  return parsed.success ? null : parsed.error.issues[0].message;
}

describe("the location dialog (ADR 0059, part 4a)", () => {
  it("LNP1 the form takes the API's floor area at scale and the rule's lengths", () => {
    expect(formProblem(values(DENVER))).toBeNull();
    expect(formProblem(values(DENVER, { floorAreaSqFt: "" }))).toBeNull();
    expect(formProblem(values(DENVER, { floorAreaSqFt: "12." }))).toBe(LOCATION_MESSAGES.floorArea);
    expect(formProblem(values(DENVER, { floorAreaSqFt: ".5" }))).toBe(LOCATION_MESSAGES.floorArea);
    expect(formProblem(values(DENVER, { name: "n".repeat(81) }))).toBe(LOCATION_MESSAGES.nameLength);
    expect(formProblem(values(STUDIO, { displaySamples: 100_001 }))).toBe(LOCATION_MESSAGES.samples);
  });

  it("LNP2 what is sent: the stored branch on an edit, the new id on an add, no blank floor area", () => {
    const edited = locationSave(values(STUDIO, { branchId: "b2" }), STUDIO, ALL, BRANCHES, "new-id").location;
    expect(edited.branchId).toBe("b1");
    expect(edited.id).toBe("s");
    const added = locationSave(
      values(STUDIO, { name: "Annex", branchId: "b2", floorAreaSqFt: "" }),
      null,
      ALL,
      BRANCHES,
      "new-id",
    ).location;
    expect(added).toMatchObject({ id: "new-id", branchId: "b2", isDefault: false, displaySamples: 140 });
    expect("floorAreaSqFt" in added).toBe(false);
    const warehouse = locationSave(
      values(STUDIO, { name: "Annex", kind: "warehouse", isDefault: true, displaySamples: 7 }),
      null,
      ALL,
      BRANCHES,
      "new-id",
    ).location;
    expect(warehouse).toMatchObject({ isDefault: true, displaySamples: 0 });
    const showroom = locationSave(values(STUDIO, { isDefault: true }), STUDIO, ALL, BRANCHES, "new-id").location;
    expect(showroom.isDefault).toBe(false);
  });

  it("LNP3 the shared rule runs before anything is sent", () => {
    expect(locationSave(values(STUDIO, { name: "denver central" }), STUDIO, ALL, BRANCHES, "x").problem).toBe(
      LOCATION_MESSAGES.sameName("Denver Central"),
    );
    expect(locationSave(values(DENVER, { isDefault: false }), DENVER, ALL, BRANCHES, "x").problem).toBe(
      LOCATION_MESSAGES.oneDefault,
    );
    expect(locationSave(values(STUDIO, { name: "Studio" }), STUDIO, ALL, BRANCHES, "x").problem).toBeNull();
  });
});
