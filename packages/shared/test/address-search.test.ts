import { describe, expect, it } from "vitest";
import { DEMO_CITIES, searchDemoAddresses } from "../src";

describe("offline address suggestions (spec A6)", () => {
  it("completes a typed house number and street in the preferred state", () => {
    const results = searchDemoAddresses("123 Main", { near: "CO" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ text: "123 Main Street", address: { state: "CO" } });
    expect(results[0]!.address.county).toBeTruthy();
  });

  it("finds the named city, even typed short", () => {
    const results = searchDemoAddresses("123 Main St, Sacramento, Calif");
    expect(results[0]?.address).toMatchObject({ street: "123 Main Street", city: "Sacramento", state: "CA" });
    expect(results[0]?.address.zip).toMatch(/^\d{5}$/);
  });

  it("suggests full seeded addresses for a place", () => {
    const results = searchDemoAddresses("Colorado Springs");
    expect(results.every((r) => r.address.city === "Colorado Springs")).toBe(true);
    expect(results[0]?.address.county).toBe("El Paso");
  });

  it("covers every state in the city list", () => {
    expect(new Set(DEMO_CITIES.map((c) => c.state)).size).toBeGreaterThanOrEqual(50);
  });
});
