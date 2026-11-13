import type { ApiClient } from "../contract";
import type { HttpTransport } from "./transport";

/**
 * Builds one ApiClient method on top of the HTTP transport. `demo` is the demo client, for methods
 * such as `list` that the API serves for some collections only while modules move one at a time.
 */
export type HttpMethodFactory<K extends keyof ApiClient> = (http: HttpTransport, demo: ApiClient) => ApiClient[K];

/** The ApiClient methods the real API serves, each with its HTTP implementation. */
export type HttpRoutes = { [K in keyof ApiClient]?: HttpMethodFactory<K> };

/**
 * One ApiClient that sends the methods listed in `routes` to apps/api and every other method to
 * the demo client. Modules move to the real API one at a time by adding their methods to the
 * routes (docs/real-build-plan.md); screens never change (CLAUDE.md rule 1).
 */
export function routeClient(demo: ApiClient, http: HttpTransport, routes: HttpRoutes): ApiClient {
  const built = new Map<PropertyKey, unknown>();
  return new Proxy(demo, {
    get(target, property, receiver) {
      const factory = routes[property as keyof ApiClient] as
        ((http: HttpTransport, demo: ApiClient) => unknown) | undefined;
      if (!factory) {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (!built.has(property)) built.set(property, factory(http, target));
      return built.get(property);
    },
  });
}
