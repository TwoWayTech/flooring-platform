import { describe, expect, it } from "vitest";
import { HttpTransport } from "@/lib/api/http/transport";

/** A fetch whose answers wait until released, recording each "METHOD path" it was asked for. */
function heldFetch() {
  const calls: string[] = [];
  const waiting: { method: string; release: () => void }[] = [];
  let version = 0;
  const fetcher = ((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.replace("http://api.test", "")}`);
    const body = JSON.stringify({ version: method === "GET" ? version : ++version });
    return new Promise<Response>((resolve) =>
      waiting.push({ method, release: () => resolve(new Response(body, { status: 200 })) }),
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
});
