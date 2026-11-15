import { dataSource } from "@/lib/data-source";
import { API_PROXY_PATH } from "@/lib/session/auth-cookie";
import type { ApiClient } from "./contract";
import { DemoStore } from "./demo/store";
import { API_METHODS } from "./http/api-methods";
import { routeClient } from "./http/router";
import { HttpTransport } from "./http/transport";
import { withSimulatedNetwork } from "./network";
import { withStandingWatch } from "./standing-watch";

/**
 * The app's single ApiClient. In demo mode it is DemoStore. In api mode the methods listed in
 * API_METHODS go to apps/api through the same-origin proxy (next.config.ts), so the session
 * cookie goes with them, and the rest stay on DemoStore until their module moves
 * (docs/real-build-plan.md).
 */
function createApiClient(): ApiClient {
  const demo = new DemoStore();
  if (dataSource() === "demo") return demo;
  const http = new HttpTransport(API_PROXY_PATH);
  return routeClient(demo, http, API_METHODS);
}

/**
 * The client every screen uses, behind the presenter's simulated network (normal by default). The
 * standing watch hears the API's company refusals, so the shell can show the maintenance, unavailable
 * and suspended screens (docs/specs/platform-admin.md, part 4); the demo's own errors never signal.
 */
export const api: ApiClient = withSimulatedNetwork(withStandingWatch(createApiClient()));
export type * from "./contract";
