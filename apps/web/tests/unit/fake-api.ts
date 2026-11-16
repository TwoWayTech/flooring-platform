import type { ApiClient } from "@/lib/api/contract";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpTransport } from "@/lib/api/http/transport";

/** How the fake API answers one request: a status with a JSON body, or a request that never arrives. */
export type FakeAnswer = { status: number; body?: unknown } | "network";

/** One request the client sent: "METHOD path" and its JSON body. */
export interface SentRequest {
  call: string;
  body: unknown;
}

/**
 * The real API_METHODS over a fake fetch that records each request and answers per "METHOD path".
 * A call with no answer of its own gets `fallback(call)`, which is 200 with an empty object unless
 * a test says otherwise. The demo client is a stub, so a routed method that fell through to it
 * would throw. `changes` counts the re-reads the screens were told to do (ADR 0051, 2026-11-16).
 */
export function fakeApi(
  answers: Record<string, FakeAnswer> = {},
  fallback: (call: string) => FakeAnswer = () => ({ status: 200, body: {} }),
) {
  const sent: SentRequest[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const call = `${init?.method ?? "GET"} ${url.replace("http://api.test", "")}`;
    sent.push({ call, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const answer = answers[call] ?? fallback(call);
    if (answer === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  }) as unknown as typeof fetch;
  const demo = { subscribe: () => () => undefined } as unknown as ApiClient;
  const client = routeClient(demo, new HttpTransport("http://api.test", fetcher), API_METHODS);
  let changes = 0;
  client.subscribe(() => changes++);
  return { client, sent, changes: () => changes, calls: () => sent.map((s) => s.call).sort() };
}
