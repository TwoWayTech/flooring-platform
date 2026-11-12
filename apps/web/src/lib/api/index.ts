import { dataSource } from "@/lib/data-source";
import type { ApiClient } from "./contract";
import { DemoStore } from "./demo/store";
import { API_METHODS } from "./http/api-methods";
import { routeClient } from "./http/router";
import { HttpTransport } from "./http/transport";
import { withSimulatedNetwork } from "./network";

/**
 * The app's single ApiClient. In demo mode it is DemoStore. In api mode the methods listed in
 * API_METHODS go to apps/api at NEXT_PUBLIC_API_URL and the rest stay on DemoStore until their
 * module moves (docs/real-build-plan.md).
 */
function createApiClient(): ApiClient {
  const demo = new DemoStore();
  if (dataSource() === "demo") return demo;
  const http = new HttpTransport(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000");
  return routeClient(demo, http, API_METHODS);
}

/** The client every screen uses, behind the presenter's simulated network (normal by default). */
export const api: ApiClient = withSimulatedNetwork(createApiClient());
export type * from "./contract";
