import { tenants } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness } from "./auth-harness";

describe("GET /public/branding?host= (P8 part 2, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();

  beforeAll(async () => {
    await harness.start();
  }, 60_000);

  afterAll(async () => {
    await harness.stop();
  });

  const branding = (host: string) => harness.get(`/public/branding?host=${encodeURIComponent(host)}`);

  it("returns the company's display fields for its host, without signing in", async () => {
    const response = await branding("summit.flooringsuite.test").expect(200);
    expect(Object.keys(response.body).sort()).toEqual([
      "brandColor",
      "defaultTheme",
      "displayName",
      "monogram",
      "pattern",
    ]);
    expect(response.body.brandColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("accepts a host with a port and any letter case", async () => {
    await branding("SUMMIT.flooringsuite.test:3000").expect(200);
  });

  it("answers 404 for a host that names no company", async () => {
    const response = await branding("nobody.flooringsuite.test").expect(404);
    expect(response.body.code).toBe("not_found");
    await branding("localhost:3000").expect(404);
  });

  it("answers 404 for a deleted company", async () => {
    const slug = `gone-${uuidv7().slice(-8)}`;
    const id = await harness.addCompany(slug, { idleMin: 30, absoluteMin: 720 });
    await branding(`${slug}.flooringsuite.test`).expect(200);
    await harness.control.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, id));
    await branding(`${slug}.flooringsuite.test`).expect(404);
  });

  it("answers 400 when host is missing or not a host name", async () => {
    expect((await harness.get("/public/branding").expect(400)).body.code).toBe("invalid_request");
    await branding("summit.flooringsuite.test/../admin").expect(400);
  });
});
