import { describe, expect, it } from "vitest";
import type { Location } from "@workspace/shared";
import { fakeApi } from "./fake-api";

const V7 = "0195f3a2-7b1c-7d4e-8f00-00000000d001";
// The seed's ids are UUID v5 (`seedId`), so any UUID is a saved location.
const V5 = "8a1d0c3e-5b2f-5c1d-9e4a-0b6c7d8e9f10";

/** A location as the API answers it. */
const SAVED: Location = {
  id: V7,
  name: "Southgate Showroom",
  kind: "showroom",
  branchId: "0195f3a2-7b1c-7d4e-8f00-00000000d002",
  address: { street: "3380 Meadowgate Drive", city: "Colorado Springs", state: "CO", zip: "80920" },
  isDefault: false,
  displaySamples: 96,
  floorAreaSqFt: "2400.000",
};

/** The fields a write sends: the location without its id. */
function withoutId(location: Location) {
  const copy: Partial<Location> = { ...location };
  delete copy.id;
  return copy;
}

describe("Warehouses and showrooms on the API (ADR 0059, part 4a)", () => {
  it("LNW1 list and get read GET /locations; a 403 reads as none; nothing reaches the demo", async () => {
    const api = fakeApi({ "GET /locations": { status: 200, body: [SAVED] } });
    expect(await api.client.list("locations")).toEqual([SAVED]);
    expect(await api.client.get("locations", V7)).toEqual(SAVED);
    expect(await api.client.get("locations", V5)).toBeUndefined();
    expect(api.calls()).toEqual(["GET /locations", "GET /locations", "GET /locations"]);
    const hr = fakeApi({ "GET /locations": { status: 403, body: { code: "module_not_enabled", message: "No." } } });
    expect(await hr.client.list("locations")).toEqual([]);
  });

  it("LNW2 a new location goes to POST, a saved one to PUT, never with its id in the body", async () => {
    const api = fakeApi({}, (call) =>
      call.startsWith("POST") || call.startsWith("PUT") ? { status: 200, body: SAVED } : { status: 404 },
    );
    const fresh: Location = { ...SAVED, id: "summit-loc-1a2b3c4d" };
    expect(await api.client.saveLocation(fresh)).toEqual(SAVED);
    expect(await api.client.saveLocation(SAVED)).toEqual(SAVED);
    expect(await api.client.saveLocation({ ...SAVED, id: V5 })).toEqual(SAVED);
    expect(api.sent.map((request) => request.call)).toEqual([
      "POST /locations",
      `PUT /locations/${V7}`,
      `PUT /locations/${V5}`,
    ]);
    for (const request of api.sent) {
      expect(request.body).toEqual(withoutId(SAVED));
      expect(request.body).not.toHaveProperty("id");
    }
    expect(api.changes()).toBe(3);
  });
});
