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

  /**
   * A client with one routed write that only sends its request: the transport, not the factory,
   * makes the screens read again (ADR 0051, "Re-reading after every write", 2026-11-16).
   */
  function writingClient(demo: ReturnType<typeof fakeDemo>) {
    const http = new HttpTransport("http://api.test", fetchReturning(200, { id: "m1" }));
    return routeClient(demo as unknown as ApiClient, http, {
      cancelMeeting: (transport) => (id) =>
        transport.request<Awaited<ReturnType<ApiClient["cancelMeeting"]>>>("POST", `/meetings/${id}/cancel`),
    });
  }

  it("re-reads subscribed screens after a routed write, and still passes the demo store's own changes on", async () => {
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

/**
 * Which requests make the screens read again (ADR 0051, "Re-reading after every write", 2026-11-16):
 * a write the server answered, never a read. `rereads` counts the calls to `changed`.
 */
describe("HttpTransport re-reads", () => {
  function transport(fetcher: typeof fetch) {
    let rereads = 0;
    const http = new HttpTransport("http://api.test", fetcher).withRereads(() => rereads++);
    return { http, rereads: () => rereads };
  }

  /** A fetch that answers `status`, and records when the answer's body is read. */
  function answering(status: number, order: string[] = []) {
    return (async () => {
      const response = new Response(JSON.stringify({ code: "refused", message: "Refused." }), { status });
      const json = response.json.bind(response);
      response.json = async () => {
        order.push("parsed");
        return json();
      };
      return response;
    }) as unknown as typeof fetch;
  }

  it("never re-reads after a GET, answered or refused", async () => {
    for (const status of [200, 400, 404, 409]) {
      const { http, rereads } = transport(answering(status));
      await http.request("GET", "/invoices").catch(() => undefined);
      expect(rereads(), `status ${status}`).toBe(0);
    }
  });

  it("re-reads once after a POST, PUT, PATCH or DELETE the server saved", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const { http, rereads } = transport(answering(200));
      await http.request(method, "/somewhere", {});
      expect(rereads(), method).toBe(1);
    }
    const { http, rereads } = transport(fetchReturning(204, null));
    await expect(http.request("DELETE", "/roles/r1")).resolves.toBeUndefined();
    expect(rereads()).toBe(1);
  });

  it("re-reads before the answer's body is read, so a saved write whose body fails to parse still re-reads, then rejects", async () => {
    const order: string[] = [];
    let rereads = 0;
    const http = new HttpTransport("http://api.test", answering(200, order)).withRereads(() => {
      rereads++;
      order.push("re-read");
    });
    await http.request("POST", "/payments", {});
    expect(order).toEqual(["re-read", "parsed"]);

    const broken = new HttpTransport(
      "http://api.test",
      (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch,
    ).withRereads(() => rereads++);
    await expect(broken.request("POST", "/payments", {})).rejects.toBeInstanceOf(SyntaxError);
    expect(rereads).toBe(2);
  });

  it("re-reads after the server refused a write (400, 403, 404, 409, 422), and still rejects in its words", async () => {
    for (const status of [400, 403, 404, 409, 422]) {
      const { http, rereads } = transport(answering(status));
      await expect(http.request("POST", "/payments", {})).rejects.toMatchObject({ status, message: "Refused." });
      expect(rereads(), `status ${status}`).toBe(1);
    }
  });

  it("doesn't re-read when a write never reached the server, or after a 401, a 429 or a server failure", async () => {
    const offline = transport((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(offline.http.request("POST", "/payments", {})).rejects.toMatchObject({ status: 0 });
    expect(offline.rereads()).toBe(0);
    for (const status of [401, 429, 500, 503]) {
      const { http, rereads } = transport(answering(status));
      await expect(http.request("POST", "/payments", {})).rejects.toBeInstanceOf(HttpApiError);
      expect(rereads(), `status ${status}`).toBe(0);
    }
  });

  it("never re-reads after requestAsRead or a file download", async () => {
    for (const status of [200, 400, 409, 422]) {
      const { http, rereads } = transport(answering(status));
      await http.requestAsRead("POST", "/imports/check", {}).catch(() => undefined);
      await http.blob("/files/f1").catch(() => undefined);
      expect(rereads(), `status ${status}`).toBe(0);
    }
  });

  it("calls nothing from a transport built without withRereads", async () => {
    const http = new HttpTransport("http://api.test", answering(200));
    await expect(http.request("POST", "/payments", {})).resolves.toEqual({ code: "refused", message: "Refused." });
  });
});
