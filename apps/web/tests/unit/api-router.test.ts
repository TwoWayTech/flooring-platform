import { describe, expect, it } from "vitest";
import type { ApiClient } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/errors";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";

/** A stand-in for DemoStore with the two methods these tests touch. */
function fakeDemo() {
  const demo = {
    calls: [] as string[],
    today() {
      demo.calls.push("today");
      return "2026-11-12";
    },
    async getCompany() {
      demo.calls.push("getCompany");
      return { name: "from demo" };
    },
  };
  return demo;
}

function fetchReturning(status: number, body: unknown, seen: { url: string; init?: RequestInit }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("routeClient", () => {
  it("sends only the routed methods to the API and keeps the rest on the demo store", async () => {
    const demo = fakeDemo();
    const seen: { url: string; init?: RequestInit }[] = [];
    const http = new HttpTransport("http://api.test", fetchReturning(200, { name: "from api" }, seen));
    const client = routeClient(demo as unknown as ApiClient, http, {
      getCompany: (transport) => () => transport.request("GET", "/company"),
    });

    expect(await client.getCompany()).toEqual({ name: "from api" });
    expect(client.today()).toBe("2026-11-12");
    expect(demo.calls).toEqual(["today"]);
    expect(seen[0].url).toBe("http://api.test/company");
    expect(seen[0].init?.credentials).toBe("include");
  });

  it("with no routes, behaves exactly like the demo store", async () => {
    const demo = fakeDemo();
    const client = routeClient(demo as unknown as ApiClient, new HttpTransport("http://api.test"), {});
    expect(await client.getCompany()).toEqual({ name: "from demo" });
  });
});

describe("HttpTransport", () => {
  it("turns the API's error body into an ApiError the screens already show", async () => {
    const http = new HttpTransport(
      "http://api.test",
      fetchReturning(409, { code: "conflict", message: "This invoice already has a payment waiting." }),
    );
    const error = await http.request("POST", "/payments", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "conflict",
      message: "This invoice already has a payment waiting.",
    });
  });

  it("reports an unreachable server in words, not as a TypeError", async () => {
    const http = new HttpTransport("http://api.test", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(http.request("GET", "/company")).rejects.toBeInstanceOf(HttpApiError);
  });
});
