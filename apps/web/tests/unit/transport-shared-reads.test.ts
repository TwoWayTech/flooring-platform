import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyAnswer } from "@workspace/shared";
import type { ApiClient } from "@/lib/api/contract";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpTransport } from "@/lib/api/http/transport";
import { signOutOfApi } from "@/lib/session/api-auth";

/**
 * A fetch whose answers wait until released, recording each "METHOD path" it was asked for. Each
 * answer carries the "version" it was asked at; `bodies` gives a path its own body.
 */
function heldFetch(bodies: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const waiting: { method: string; path: string; release: () => void }[] = [];
  let version = 0;
  const fetcher = ((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace("http://api.test", "");
    calls.push(`${method} ${path}`);
    const body = JSON.stringify(bodies[path] ?? { version: method === "GET" ? version : ++version });
    return new Promise<Response>((resolve) =>
      waiting.push({ method, path, release: () => resolve(new Response(body, { status: 200 })) }),
    );
  }) as unknown as typeof fetch;
  const releaseAll = () => waiting.splice(0).forEach((entry) => entry.release());
  /** Answers only the waiting requests with this method. */
  const release = (method: string) => {
    for (const entry of waiting.filter((candidate) => candidate.method === method)) {
      waiting.splice(waiting.indexOf(entry), 1);
      entry.release();
    }
  };
  return { fetcher, calls, releaseAll, release };
}

// Sharing and the gate apply in a browser only (`ReadShare`); these tests are the browser's.
beforeEach(() => vi.stubGlobal("window", {}));
afterEach(() => vi.unstubAllGlobals());

describe("HttpTransport shares a GET still in flight (finding #29)", () => {
  it("sends one request for identical GETs made at once, and gives each caller its own copy", async () => {
    const held = heldFetch();
    const http = new HttpTransport("http://api.test", held.fetcher);
    const first = http.request<{ version: number }>("GET", "/locations");
    const second = http.request<{ version: number }>("GET", "/locations");
    held.releaseAll();
    const [a, b] = await Promise.all([first, second]);
    expect(held.calls).toEqual(["GET /locations"]);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("sends a GET again once the first has answered", async () => {
    const held = heldFetch();
    const http = new HttpTransport("http://api.test", held.fetcher);
    const first = http.request("GET", "/locations");
    held.releaseAll();
    await first;
    const second = http.request("GET", "/locations");
    held.releaseAll();
    await second;
    expect(held.calls).toEqual(["GET /locations", "GET /locations"]);
  });

  it("never answers a read made after a write with a request from before it", async () => {
    const held = heldFetch();
    const http = new HttpTransport("http://api.test", held.fetcher);
    const before = http.request<{ version: number }>("GET", "/locations");
    const write = http.request("POST", "/locations", { name: "North" });
    // The write is answered while the earlier read is still waiting.
    held.release("POST");
    await write;
    const after = http.request<{ version: number }>("GET", "/locations");
    held.releaseAll();
    const [old, fresh] = await Promise.all([before, after]);
    expect(held.calls).toEqual(["GET /locations", "POST /locations", "GET /locations"]);
    expect([old.version, fresh.version]).toEqual([0, 1]);
  });

  it("shares nothing on the server, where one client serves every rendering request", async () => {
    vi.unstubAllGlobals();
    const held = heldFetch();
    const http = new HttpTransport("http://api.test", held.fetcher);
    const reads = [http.request("GET", "/locations"), http.request("GET", "/locations")];
    held.releaseAll();
    await Promise.all(reads);
    expect(held.calls).toEqual(["GET /locations", "GET /locations"]);
  });
});

/** GET /company for company `slug`, whose person holds `permissions`. */
function companyAnswer(slug: string, permissions: string[]): CompanyAnswer {
  return {
    company: { id: slug, slug, name: slug, city: "", state: "", timeZone: "America/Denver", modules: [], branches: [] },
    me: { id: "me", name: "Me" },
    roles: [],
    access: { permissions, dataScope: "own", isOwner: false },
    people: [],
  } as unknown as CompanyAnswer;
}

describe("a company or session change shares nothing across it (review of #96)", () => {
  it("a read made after a company switch never gets the answer of a read sent before it", async () => {
    const held = heldFetch();
    const http = new HttpTransport("http://api.test", held.fetcher);
    const companyA = http.request("GET", "/invoices");
    http.forgetReads(); // openCompany, as the routed method calls it
    const companyB = http.request("GET", "/invoices");
    held.releaseAll();
    await Promise.all([companyA, companyB]);
    expect(held.calls).toEqual(["GET /invoices", "GET /invoices"]);
  });

  it("the routed openCompany forgets the reads in flight", async () => {
    const held = heldFetch();
    const demo = { subscribe: () => () => undefined, openCompany: async () => undefined } as unknown as ApiClient;
    const client = routeClient(demo, new HttpTransport("http://api.test", held.fetcher), API_METHODS);
    const before = client.list("invoices");
    await client.openCompany("summit" as Parameters<ApiClient["openCompany"]>[0], { userId: "u", viewAsRoleId: null });
    const after = client.list("invoices");
    held.releaseAll();
    await Promise.all([before, after]);
    expect(held.calls).toEqual(["GET /invoices", "GET /invoices"]);
  });

  it("signing out forgets every client's reads in flight", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const held = heldFetch();
    const http = new HttpTransport("http://api.test", held.fetcher);
    const before = http.request("GET", "/invoices");
    await signOutOfApi();
    const after = http.request("GET", "/invoices");
    held.releaseAll();
    await Promise.all([before, after]);
    expect(held.calls).toEqual(["GET /invoices", "GET /invoices"]);
  });

  it("a GET /company answer sent before a switch is not learned as the new company's access", async () => {
    const held = heldFetch({ "/company": companyAnswer("a", ["dashboard.overview.view"]) });
    const demo = { subscribe: () => () => undefined, openCompany: async () => undefined } as unknown as ApiClient;
    const client = routeClient(demo, new HttpTransport("http://api.test", held.fetcher), API_METHODS);
    const stale = client.getWorkspace();
    await client.openCompany("b" as Parameters<ApiClient["openCompany"]>[0], { userId: "u", viewAsRoleId: null });
    held.releaseAll();
    await stale;
    // Had A's access been learned, Sales-less A would skip /lien-waivers; unknown access sends it.
    const read = client.contractsData();
    held.releaseAll();
    await read.catch(() => undefined);
    expect(held.calls).toContain("GET /lien-waivers");
  });

  it("a current GET /company answer is learned: a list the role can't read is not asked for", async () => {
    const held = heldFetch({ "/company": companyAnswer("a", ["dashboard.overview.view"]) });
    const demo = { subscribe: () => () => undefined } as unknown as ApiClient;
    const client = routeClient(demo, new HttpTransport("http://api.test", held.fetcher), API_METHODS);
    const workspace = client.getWorkspace();
    held.releaseAll();
    await workspace;
    const read = client.contractsData();
    held.releaseAll();
    await read.catch(() => undefined);
    expect(held.calls).not.toContain("GET /lien-waivers");
  });
});
