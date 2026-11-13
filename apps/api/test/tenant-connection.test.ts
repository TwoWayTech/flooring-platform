import type { ConfigService } from "@nestjs/config";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../src/core/auth/session.service";
import type { ApiEnv } from "../src/core/config/env";
import { TenantConnectionService } from "../src/core/tenancy/tenant-connection.service";
import { TenantContext } from "../src/core/tenancy/tenant-context";
import type { CompanyAccess } from "../src/core/tenancy/tenant-directory";

/** Company pools as the fake openCompanyDb hands them out, so the tests can see what was opened and closed. */
const opened: { url: string; close: ReturnType<typeof vi.fn> }[] = [];

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  decryptSecret: (value: string) => value,
  openCompanyDb: (url: string): DbHandle<CompanyDb> => {
    const close = vi.fn(() => Promise.resolve());
    opened.push({ url, close });
    return { db: { url } as unknown as CompanyDb, close };
  },
}));

/**
 * A control database whose tenant_databases lookups answer, in order, a ready database for each
 * company the test will open. The service looks a company up only when it opens a new pool.
 */
function fakeControl(companies: readonly string[]): DbHandle<ControlDb> {
  const queue = [...companies];
  const query = {
    select: () => query,
    from: () => query,
    where: () => Promise.resolve([{ encryptedUrl: `postgres://${queue.shift() ?? "unexpected"}`, status: "ready" }]),
  };
  return { db: query as unknown as ControlDb, close: () => Promise.resolve() };
}

function service(limit: number, opensFor: readonly string[] = []): TenantConnectionService {
  const config = {
    get: (key: keyof ApiEnv) => (key === "TENANT_POOL_CACHE" ? limit : "unused-key"),
  } as unknown as ConfigService<ApiEnv, true>;
  return new TenantConnectionService(fakeControl(opensFor), config);
}

function tenantFor(companyId: string): TenantContext {
  const session = {
    user: { id: "user-1", name: "U", email: "u@example.test" },
    sessionId: "s",
    sessionCreatedAt: new Date(),
    companyId,
  } as AuthSession;
  const company: CompanyAccess = {
    id: companyId,
    status: "active",
    products: ["flooring"],
    maintenanceMode: false,
    phase: "full",
    databaseStatus: "ready",
  };
  return TenantContext.fromVerifiedSession(session, company);
}

describe("TenantConnectionService (P9: the only way to a company database)", () => {
  afterEach(() => {
    opened.length = 0;
    vi.useRealTimers();
  });

  it("refuses a look-alike object, so a company can never come from a request", async () => {
    const lookAlike = { companyId: "company-b", userId: "x", products: [], readOnly: false };
    // @ts-expect-error A plain object is not a TenantContext: the private #verified field makes it nominal.
    const typed: TenantContext = lookAlike;
    await expect(service(2).db(typed)).rejects.toThrow(/verified TenantContext/);
    expect(opened).toHaveLength(0);
  });

  it("refuses a context for a company other than the session's open one", () => {
    const session = { user: { id: "u" }, companyId: "company-a" } as AuthSession;
    const company = { id: "company-b" } as CompanyAccess;
    expect(() => TenantContext.fromVerifiedSession(session, company)).toThrow(/open company/);
  });

  it("takes an evicted pool back during its grace period instead of opening a second one", async () => {
    vi.useFakeTimers();
    const connections = service(1, ["company-a", "company-b"]);
    await connections.db(tenantFor("company-a"));
    await connections.db(tenantFor("company-b"));
    expect(connections.retiringPools).toBe(1);
    await connections.db(tenantFor("company-a"));
    expect(opened.map((pool) => pool.url)).toEqual(["postgres://company-a", "postgres://company-b"]);
    expect(opened.every((pool) => pool.close.mock.calls.length === 0)).toBe(true);
  });

  it("closes an evicted pool after the grace period, and the oldest at once when too many wait", async () => {
    vi.useFakeTimers();
    const connections = service(1, ["company-a", "company-b", "company-c"]);
    await connections.db(tenantFor("company-a"));
    await connections.db(tenantFor("company-b"));
    await connections.db(tenantFor("company-c"));
    expect(opened[0].close).toHaveBeenCalledTimes(1);
    expect(connections.retiringPools).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(opened[1].close).toHaveBeenCalledTimes(1);
    expect(connections.retiringPools).toBe(0);
    expect(opened[2].close).not.toHaveBeenCalled();
  });
});
