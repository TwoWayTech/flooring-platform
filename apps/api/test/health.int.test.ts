import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const controlUrl = process.env.CONTROL_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/control";
const key = Buffer.alloc(32, 7).toString("base64");

/** Starts the app against the given control database, the way main.ts does. */
async function start(databaseUrl: string): Promise<INestApplication> {
  Object.assign(process.env, {
    CONTROL_DATABASE_URL: databaseUrl,
    CONNECTION_ENCRYPTION_KEY: key,
    TENANT_DB_ADMIN_URL: controlUrl,
    APP_VERSION: "test",
  });
  const app = await createApp();
  await app.init();
  return app;
}

describe("API base (needs the local PostgreSQL)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("reports healthy when the control database answers", async () => {
    app = await start(controlUrl);
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok", version: "test", database: "up" });
  });

  it("answers 503 when the control database is down", async () => {
    app = await start("postgres://postgres:postgres@127.0.0.1:1/control");
    const response = await request(app.getHttpServer()).get("/health").expect(503);
    expect(response.body).toMatchObject({ status: "degraded", database: "down" });
  });

  it("serves the OpenAPI document with the health endpoint in it", async () => {
    app = await start(controlUrl);
    const response = await request(app.getHttpServer()).get("/docs/openapi.json").expect(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.paths).toHaveProperty("/health");
  });

  it("answers unknown routes with the shared error body", async () => {
    app = await start(controlUrl);
    const response = await request(app.getHttpServer()).get("/no-such-thing").expect(404);
    expect(response.body).toMatchObject({ code: "not_found" });
    expect(typeof response.body.message).toBe("string");
  });

  it("allows cookies only from the configured web origin", async () => {
    app = await start(controlUrl);
    const response = await request(app.getHttpServer()).get("/health").set("Origin", "http://localhost:3000");
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    const stranger = await request(app.getHttpServer()).get("/health").set("Origin", "https://evil.example");
    expect(stranger.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
