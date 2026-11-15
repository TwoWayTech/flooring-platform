import { describe, expect, it } from "vitest";
import type { ApiClient } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/errors";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";

/** A stand-in for DemoStore with the methods these tests touch; `emit` is a change the demo store makes itself. */
function fakeDemo() {
  const demo = {
    calls: [] as string[],
    listeners: new Set<() => void>(),
    subscribe(listener: () => void) {
      demo.listeners.add(listener);
      return () => void demo.listeners.delete(listener);
    },
    emit() {
      demo.listeners.forEach((listener) => listener());
    },
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

  /** A client whose one routed write tells the screens it changed data (ADR 0051 part 3). */
  function writingClient(demo: ReturnType<typeof fakeDemo>) {
    const http = new HttpTransport("http://api.test", fetchReturning(200, { id: "m1" }));
    return routeClient(demo as unknown as ApiClient, http, {
      cancelMeeting: (transport, _demo, changed) => async (id) => {
        const saved = await transport.request<Awaited<ReturnType<ApiClient["cancelMeeting"]>>>(
          "POST",
          `/meetings/${id}/cancel`,
        );
        changed();
        return saved;
      },
    });
  }

  it("re-reads subscribed screens after a routed write reports a change, and still passes the demo store's own changes on", async () => {
    const demo = fakeDemo();
    const client = writingClient(demo);
    const heard: string[] = [];
    client.subscribe(() => heard.push("screen"));

    await client.cancelMeeting("m1");
    expect(heard).toEqual(["screen"]);
    demo.emit();
    expect(heard).toEqual(["screen", "screen"]);
  });

  it("unsubscribing stops both", async () => {
    const demo = fakeDemo();
    const client = writingClient(demo);
    const heard: string[] = [];
    const unsubscribe = client.subscribe(() => heard.push("screen"));
    unsubscribe();

    await client.cancelMeeting("m1");
    demo.emit();
    expect(heard).toEqual([]);
    expect(demo.listeners.size).toBe(0);
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
