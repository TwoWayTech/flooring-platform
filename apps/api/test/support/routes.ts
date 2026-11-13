/** Lists the Nest routes on the Express app, so inventory tests can check every route (P9, P10). */

/** The HTTP methods the tests send. */
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

/** The method to probe an Express route method with. */
function verbFor(method: string): HttpMethod {
  const known: readonly HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];
  return (known as readonly string[]).includes(method) ? (method as HttpMethod) : "get";
}

/** An Express router layer, as far as listRoutes reads it. */
interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Every Nest route on the Express app (Better Auth's /api/auth/* handler is not a Nest route). */
export function listRoutes(app: {
  router?: { stack: RouterLayer[] };
}): { method: string; verb: HttpMethod; path: string }[] {
  return (app.router?.stack ?? []).flatMap(({ route }) =>
    route
      ? Object.keys(route.methods)
          // Every method, so @All(), @Head() and @Options() routes are checked too; an @All() route
          // (Express "_all") is probed with GET.
          .map((method) => ({ method: method.toUpperCase(), verb: verbFor(method), path: route.path }))
      : [],
  );
}
