import type { ApiClient } from "../contract";
import type { HttpTransport } from "./transport";

/**
 * Builds one ApiClient method on top of the HTTP transport. `demo` is the demo client, for methods
 * such as `list` that the API serves for some collections only while modules move one at a time.
 * The transport it is given makes the screens read again after every write the server answered
 * (ADR 0051, "Re-reading after every write", 2026-11-16), so a factory never does that itself.
 */
export type HttpMethodFactory<K extends keyof ApiClient> = (http: HttpTransport, demo: ApiClient) => ApiClient[K];

/** The ApiClient methods the real API serves, each with its HTTP implementation. */
export type HttpRoutes = { [K in keyof ApiClient]?: HttpMethodFactory<K> };

/**
 * One ApiClient that sends the methods listed in `routes` to apps/api and every other method to
 * the demo client. Modules move to the real API one at a time by adding their methods to the
 * routes (docs/real-build-plan.md); screens never change (CLAUDE.md rule 1).
 *
 * `subscribe` hears both the demo client's own changes and every routed write the server answered
 * (the transport decides which requests are writes; ADR 0051, 2026-11-16), so a screen re-reads
 * after a write the API served exactly as it does after a demo one.
 */
export function routeClient(demo: ApiClient, http: HttpTransport, routes: HttpRoutes): ApiClient {
  const built = new Map<PropertyKey, unknown>();
  const listeners = new Set<() => void>();
  // A copy, so a listener that unsubscribes or subscribes while it runs changes the next round only.
  const changed = () => [...listeners].forEach((listener) => listener());
  const writes = http.withRereads(changed);
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
        ((http: HttpTransport, demo: ApiClient) => unknown) | undefined;
      if (!factory) {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (!built.has(property)) built.set(property, factory(writes, target));
      return built.get(property);
    },
  });
}
