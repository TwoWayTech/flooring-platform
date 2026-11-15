import type { ApiClient } from "../contract";
import type { HttpTransport } from "./transport";

/**
 * Builds one ApiClient method on top of the HTTP transport. `demo` is the demo client, for methods
 * such as `list` that the API serves for some collections only while modules move one at a time.
 * `changed` tells the screens subscribed through the routed client that a write changed data, so
 * they read again (ADR 0051 "Part 3"); a factory that never writes ignores it.
 */
export type HttpMethodFactory<K extends keyof ApiClient> = (
  http: HttpTransport,
  demo: ApiClient,
  changed: () => void,
) => ApiClient[K];

/** The ApiClient methods the real API serves, each with its HTTP implementation. */
export type HttpRoutes = { [K in keyof ApiClient]?: HttpMethodFactory<K> };

/**
 * One ApiClient that sends the methods listed in `routes` to apps/api and every other method to
 * the demo client. Modules move to the real API one at a time by adding their methods to the
 * routes (docs/real-build-plan.md); screens never change (CLAUDE.md rule 1).
 *
 * `subscribe` hears both the demo client's own changes and the routed writes that call `changed`,
 * so a screen re-reads after a write the API served exactly as it does after a demo one.
 */
export function routeClient(demo: ApiClient, http: HttpTransport, routes: HttpRoutes): ApiClient {
  const built = new Map<PropertyKey, unknown>();
  const listeners = new Set<() => void>();
  // A copy, so a listener that unsubscribes or subscribes while it runs changes the next round only.
  const changed = () => [...listeners].forEach((listener) => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const off = demo.subscribe(listener);
    return () => {
      listeners.delete(listener);
      off();
    };
  };
  return new Proxy(demo, {
    get(target, property, receiver) {
      if (property === "subscribe") return subscribe;
      const factory = routes[property as keyof ApiClient] as
        ((http: HttpTransport, demo: ApiClient, changed: () => void) => unknown) | undefined;
      if (!factory) {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (!built.has(property)) built.set(property, factory(http, target, changed));
      return built.get(property);
    },
  });
}
