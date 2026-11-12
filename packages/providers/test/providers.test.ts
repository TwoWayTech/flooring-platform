import { describe, expect, it } from "vitest";
import {
  companyDatabaseName,
  createProviders,
  MemoryEmailProvider,
  MemoryStorageProvider,
  NeonProvisioner,
  NoopProvisioner,
  PostgresServerProvisioner,
  ResendEmailProvider,
  S3StorageProvider,
  type ResendEmails,
} from "../src";

describe("createProviders", () => {
  it("defaults to plain Postgres, memory storage and memory email", () => {
    const providers = createProviders({ TENANT_DB_ADMIN_URL: "postgres://x@localhost/postgres" });
    expect(providers.database).toBeInstanceOf(PostgresServerProvisioner);
    expect(providers.storage).toBeInstanceOf(MemoryStorageProvider);
    expect(providers.email).toBeInstanceOf(MemoryEmailProvider);
  });

  it("builds the Neon, R2 and Resend adapters from their settings", () => {
    const providers = createProviders({
      DB_PROVIDER: "neon",
      NEON_API_KEY: "key",
      STORAGE_PROVIDER: "r2",
      S3_BUCKET: "files",
      S3_REGION: "auto",
      S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_key",
      EMAIL_FROM: "Flooring Suite <hello@example.com>",
    });
    expect(providers.database).toBeInstanceOf(NeonProvisioner);
    expect(providers.storage).toBeInstanceOf(S3StorageProvider);
    expect(providers.email).toBeInstanceOf(ResendEmailProvider);
  });

  it("refuses a choice that is missing its settings", () => {
    expect(() => createProviders({ DB_PROVIDER: "neon" })).toThrow();
    expect(() => createProviders({ DB_PROVIDER: "postgres", STORAGE_PROVIDER: "s3" })).toThrow();
  });

  it("refuses a Neon region outside the US", () => {
    expect(() => createProviders({ DB_PROVIDER: "neon", NEON_API_KEY: "k", NEON_REGION: "aws-eu-central-1" })).toThrow(
      /US region/,
    );
  });
});

describe("companyDatabaseName", () => {
  it("prefixes the slug and refuses anything that could break out of an identifier", () => {
    expect(companyDatabaseName("summit")).toBe("company_summit");
    expect(() => companyDatabaseName('x"; DROP DATABASE control; --')).toThrow();
    expect(() => companyDatabaseName("Summit")).toThrow();
  });
});

describe("NeonProvisioner", () => {
  it("creates a PostgreSQL 16 project in the region and returns its pooled URL", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith("/projects")
        ? { project: { id: "proj-1" }, databases: [{ name: "neondb" }], roles: [{ name: "owner" }] }
        : { uri: "postgresql://owner:pw@ep-1-pooler.us-east-2.aws.neon.tech/neondb" };
      return new Response(JSON.stringify(body), { status: url.endsWith("/projects") ? 201 : 200 });
    }) as typeof fetch;
    const neon = new NeonProvisioner({ apiKey: "key", region: "aws-us-east-2", fetch: fakeFetch });

    const result = await neon.create({ tenantId: "t1", slug: "summit" });

    expect(result).toEqual({
      providerRef: "proj-1",
      connectionUrl: "postgresql://owner:pw@ep-1-pooler.us-east-2.aws.neon.tech/neondb",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      project: { region_id: "aws-us-east-2", pg_version: 16 },
    });
    expect(calls[1].url).toContain("pooled=true");
  });

  it("treats a project that is already gone as dropped, and reports other failures", async () => {
    const status = { value: 404 };
    const fakeFetch = (async () => new Response("{}", { status: status.value })) as unknown as typeof fetch;
    const neon = new NeonProvisioner({ apiKey: "key", region: "aws-us-east-2", fetch: fakeFetch });
    await expect(neon.drop("proj-1")).resolves.toBeUndefined();
    status.value = 500;
    await expect(neon.drop("proj-1")).rejects.toThrow(/500/);
  });
});

describe("no-op and memory adapters", () => {
  it("records provisioning without creating anything", async () => {
    const noop = new NoopProvisioner("postgres://test/db");
    await expect(noop.create({ tenantId: "t1", slug: "summit" })).resolves.toEqual({
      providerRef: "noop_summit",
      connectionUrl: "postgres://test/db",
    });
    await noop.drop("noop_summit");
    expect(noop.created).toHaveLength(1);
    expect(noop.dropped).toEqual(["noop_summit"]);
  });

  it("stores, reads and deletes files", async () => {
    const storage = new MemoryStorageProvider();
    await storage.put("t1/logo.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(await storage.get("t1/logo.png")).toEqual({ body: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    await storage.delete("t1/logo.png");
    expect(await storage.get("t1/logo.png")).toBeNull();
  });

  it("sends a message once per idempotency key", async () => {
    const email = new MemoryEmailProvider();
    const message = {
      from: "a@example.com",
      to: ["b@example.com"],
      subject: "Hi",
      text: "Hello",
      idempotencyKey: "k1",
    };
    const first = await email.send(message);
    const second = await email.send(message);
    expect(second.id).toBe(first.id);
    expect(email.sent).toHaveLength(1);
  });
});

describe("ResendEmailProvider", () => {
  it("passes the idempotency key and turns a refusal into an error", async () => {
    const received: unknown[] = [];
    const reply = { value: { data: { id: "re_1" }, error: null } as unknown };
    const emails = {
      send: async (...args: unknown[]) => {
        received.push(args);
        return reply.value;
      },
    } as unknown as ResendEmails;
    const resend = new ResendEmailProvider("key", emails);
    const message = { from: "a@example.com", to: ["b@example.com"], subject: "Hi", text: "Hello", idempotencyKey: "k" };

    await expect(resend.send(message)).resolves.toEqual({ id: "re_1" });
    expect(received[0]).toMatchObject([{ subject: "Hi" }, { idempotencyKey: "k" }]);

    reply.value = { data: null, error: { message: "invalid from" } };
    await expect(resend.send(message)).rejects.toThrow(/invalid from/);
  });
});
